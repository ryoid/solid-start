import * as route from './route';

const FETCH_EVENT = "$FETCH";

/**
 * Adapted from https://github.com/magne4000/vite-plugin-vercel/blob/a6afe7084dde9340cab451afa653feaf53d8b6a5/packages/vite-plugin-ssr/templates/helpers.ts#L51
 * Send a default empty HTML response
 * @param {import('http').ServerResponse} res
 */
function getDefaultEmptyResponseHandler(res) {
  res.statusCode = 200;
  res.setHeader('content-type', 'text/html; charset=UTF-8');
  return res.end('');
}

/**
 * Helper from SvelteKit https://github.com/sveltejs/kit/blob/e7bc0be2b25aff5ac151e3d83b771ad80cac1ab8/packages/kit/src/exports/node/index.js#L8
 * @param {import('http').IncomingMessage} req
 * @param {number} [body_size_limit]
 */
function get_raw_body(req, body_size_limit) {
	const h = req.headers;

	if (!h['content-type']) {
		return null;
	}

	const content_length = Number(h['content-length']);

	// check if no request body
	if (
		(req.httpVersionMajor === 1 && isNaN(content_length) && h['transfer-encoding'] == null) ||
		content_length === 0
	) {
		return null;
	}

	let length = content_length;

	if (body_size_limit) {
		if (!length) {
			length = body_size_limit;
		} else if (length > body_size_limit) {
			throw error(
				413,
				`Received content-length of ${length}, but only accept up to ${body_size_limit} bytes.`
			);
		}
	}

	if (req.destroyed) {
		const readable = new ReadableStream();
		readable.cancel();
		return readable;
	}

	let size = 0;
	let cancelled = false;

	return new ReadableStream({
		start(controller) {
			req.on('error', (error) => {
				cancelled = true;
				controller.error(error);
			});

			req.on('end', () => {
				if (cancelled) return;
				controller.close();
			});

			req.on('data', (chunk) => {
				if (cancelled) return;

				size += chunk.length;
				if (size > length) {
					cancelled = true;
					controller.error(
						error(
							413,
							`request body size exceeded ${
								content_length ? "'content-length'" : 'BODY_SIZE_LIMIT'
							} of ${length}`
						)
					);
					return;
				}

				controller.enqueue(chunk);

				if (controller.desiredSize === null || controller.desiredSize <= 0) {
					req.pause();
				}
			});
		},

		pull() {
			req.resume();
		},

		cancel(reason) {
			cancelled = true;
			req.destroy(reason);
		}
	});
}

/**
 * Helper from SvelteKit https://github.com/sveltejs/kit/blob/e7bc0be2b25aff5ac151e3d83b771ad80cac1ab8/packages/kit/src/exports/node/index.js#L96
 * @param {import('http').IncomingMessage} req
 * @param {number} [body_size_limit]
 */
async function getRequest({ request, base, bodySizeLimit }) {
	return new Request(base + request.url, {
		// @ts-expect-error
		duplex: 'half',
		method: request.method,
		headers: /** @type {Record<string, string>} */ (request.headers),
		body: get_raw_body(request, bodySizeLimit)
	});
}

// https://github.com/sveltejs/kit/blob/e7bc0be2b25aff5ac151e3d83b771ad80cac1ab8/packages/kit/src/exports/node/index.js#L107
/**
 * Send `Response` through `res`
 * Helper from SvelteKit https://github.com/sveltejs/kit/blob/e7bc0be2b25aff5ac151e3d83b771ad80cac1ab8/packages/kit/src/exports/node/index.js#L107
 * @param {import('http').ServerResponse} res
 * @param {Response} response
 */
function setResponse(
  res,
  response,
) {
  const headers = Object.fromEntries(response.headers);

	res.writeHead(response.status, headers);

	if (!response.body) {
		res.end();
		return;
	}

	if (response.body.locked) {
		res.write(
			'Fatal error: Response body is locked. ' +
				`This can happen when the response was already read (for example through 'response.json()' or 'response.text()').`
		);
		res.end();
		return;
	}

	const reader = response.body.getReader();

	if (res.destroyed) {
		reader.cancel();
		return;
	}

	const cancel = (/** @type {Error|undefined} */ error) => {
		res.off('close', cancel);
		res.off('error', cancel);

		// If the reader has already been interrupted with an error earlier,
		// then it will appear here, it is useless, but it needs to be catch.
		reader.cancel(error).catch(() => {});
		if (error) res.destroy(error);
	};

	res.on('close', cancel);
	res.on('error', cancel);

	next();
	async function next() {
		try {
			for (;;) {
				const { done, value } = await reader.read();

				if (done) break;

				if (!res.write(value)) {
					res.once('drain', next);
					return;
				}
			}
			res.end();
		} catch (error) {
			cancel(error instanceof Error ? error : new Error(String(error)));
		}
	}
}

/**
 * Adapted from SvelteKit https://github.com/sveltejs/kit/blob/master/packages/adapter-vercel/files/serverless.js#L18
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse} res
 */
export default async function (req, res) {
  const routeMatches = req.url.match(req.headers['x-route-match'])
  
  /** @type {Request} */
	let request;

	try {
		request = await getRequest({ base: `https://${req.headers.host}`, request: req });
	} catch (err) {
		res.statusCode = err.status || 400;
		return res.end('Invalid request body');
	}

  /** @type {Response} */
  let handlerResponse
  
  const params = {};
  if (routeMatches.groups) {
    for (const [key, value] of Object.entries(routeMatches.groups)) {
      params[key] = value
    }
  }

	try {
    // https://github.com/solidjs/solid-start/blob/eb3f2ca7c90b2f929fba40d3d561271f93a83724/packages/start/api/router.ts#L27-L41
    const handler = route[req.method];
    if (handler === "skip" || handler === void 0) {
      throw new Error(`No handler found for ${req.method} ${req.url}`);
    }

    // https://github.com/solidjs/solid-start/blob/eb3f2ca7c90b2f929fba40d3d561271f93a83724/packages/start/api/internalFetch.ts#L20-L32
    /** @type {import('solid-start').APIEvent} */
    let apiEvent = Object.freeze({
      request,
      params,
      env: {},
      $type: FETCH_EVENT,
    });

    handlerResponse = await handler(apiEvent);
	} catch (err) {
    console.error('handler error', err);
		res.statusCode = err.status || 500;
		return res.end(err.message || "Unexpected error");
	}

  
  if (!handlerResponse) {
    return getDefaultEmptyResponseHandler(res);
  }

  return setResponse(res, handlerResponse);
}

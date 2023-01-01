import common from "@rollup/plugin-commonjs";
import json from "@rollup/plugin-json";
import nodeResolve from "@rollup/plugin-node-resolve";
import { spawn } from "child_process";
import { copyFileSync, renameSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { rollup } from "rollup";
import { fileURLToPath } from "url";

export default function ({ edge, prerender, splitApis } = {}) {
  return {
    name: "vercel",
    async start() {
      const proc = await spawn("vercel", ["deploy", "--prebuilt"], {});
      proc.stdout.pipe(process.stdout);
      proc.stderr.pipe(process.stderr);
    },
    async build(config, builder) {
      // Vercel Build Output API v3 (https://vercel.com/docs/build-output-api/v3)
      const __dirname = dirname(fileURLToPath(import.meta.url));
      const appRoot = config.solidOptions.appRoot;
      const outputDir = join(config.root, ".vercel/output");

      // SSR Edge Function
      if (!config.solidOptions.ssr) {
        await builder.spaClient(join(outputDir, "static"));
        await builder.server(join(config.root, ".solid", "server"));
      } else if (config.solidOptions.islands) {
        await builder.islandsClient(join(outputDir, "static"));
        await builder.server(join(config.root, ".solid", "server"));
      } else {
        await builder.client(join(outputDir, "static"));
        await builder.server(join(config.root, ".solid", "server"));
      }

      const entrypoint = join(config.root, ".solid", "server", "server.js");

      let baseEntrypoint = "entry.js";
      if (edge) baseEntrypoint = "entry-edge.js";
      if (prerender) baseEntrypoint = "entry-prerender.js";
      copyFileSync(join(__dirname, baseEntrypoint), entrypoint);

      const bundle = await rollup({
        input: entrypoint,
        plugins: [
          json(),
          nodeResolve({
            preferBuiltins: true,
            exportConditions: edge ? ["worker", "solid"] : ["node", "solid"]
          }),
          common()
        ]
      });

      const renderEntrypoint = "index.js";
      const renderFuncDir = join(outputDir, "functions/render.func");
      await bundle.write(
        edge
          ? {
              format: "esm",
              file: join(renderFuncDir, renderEntrypoint),
              inlineDynamicImports: true
            }
          : {
              format: "cjs",
              file: join(renderFuncDir, renderEntrypoint),
              exports: "auto",
              inlineDynamicImports: true
            }
      );
      await bundle.close();

      const renderConfig = edge
        ? {
            runtime: "edge",
            entrypoint: renderEntrypoint
          }
        : {
            runtime: "nodejs16.x",
            handler: renderEntrypoint,
            launcherType: "Nodejs"
          };
      writeFileSync(join(renderFuncDir, ".vc-config.json"), JSON.stringify(renderConfig, null, 2));

      // Generate API function
      const apiRoutes = config.solidOptions.router.getFlattenedApiRoutes()
      const apiRoutesConfig = []
      if (splitApis) {
        await Promise.all(apiRoutes.map(async route => {
          const builderOutputDir = join(config.root, ".solid", "serverlessApiRoute", route.id)
          const builderOutputFile = 
          Object.values(route.apiPath)[0]
            .split('/').pop()
            .replace('ts', 'js')
            .replace('[', '_')
            .replace(']', '_')
          await builder.serverlessApiRoute(builderOutputDir, route);        
          renameSync(join(builderOutputDir, builderOutputFile), join(builderOutputDir, 'route.js'))

          const entrypoint = join(builderOutputDir, "index.js")
          if (edge) {
            copyFileSync(join(__dirname, "entry-api.js"), entrypoint);
          } else {
            copyFileSync(join(__dirname, "entry-api.js"), entrypoint);
          }
          const bundle = await rollup({
            input: entrypoint,
            plugins: [
              json(),
              nodeResolve({
                preferBuiltins: true,
                exportConditions: edge ? ["worker", "solid"] : ["node", "solid"]
              }),
              common()
            ]
          });
          const apiEntrypoint = "index.js";
          const apiFuncDir = join(outputDir, "functions", `${route.id}.func`)
          await bundle.write(
            edge
              ? {
                  format: "esm",
                  file: join(apiFuncDir, "index.js"),
                  inlineDynamicImports: true
                }
              : {
                  format: "cjs",
                  file: join(apiFuncDir, "index.js"),
                  exports: "auto",
                  inlineDynamicImports: true
                }
          );
          await bundle.close();

          const apiConfig = edge
            ? {
                runtime: "edge",
                entrypoint: apiEntrypoint
              }
            : {
                runtime: "nodejs18.x",
                handler: apiEntrypoint,
                launcherType: "Nodejs"
              };
          writeFileSync(join(apiFuncDir, ".vc-config.json"), JSON.stringify(apiConfig, null, 2));

          const routeMatch = 
            route.path.split('/')
              .map(path => 
                path[0] === ':'
                  ? `(?<${path.slice(1)}>[^/]+)`
                : path[0] === '*'
                  ? `(?<${path.slice(1)}>.*)` 
                : path
              )
              .join('/')
          apiRoutesConfig.push({ 
            src: routeMatch,
            headers: {
              "x-route-match": routeMatch
            },
            dest: route.id
          })
        }))
      }
      
      // Routing Config
      const outputConfig = {
        version: 3,
        routes: [
          // https://vercel.com/docs/project-configuration#project-configuration/headers
          // https://vercel.com/docs/build-output-api/v3#build-output-configuration/supported-properties/routes/source-route
          {
            src: "/assets/(.*)",
            headers: { "Cache-Control": "public, max-age=31556952, immutable" },
            continue: true
          },
          // Serve any matching static assets first
          { handle: "filesystem" },
          // Invoke the API function for API routes
          ...apiRoutesConfig,
          // Invoke the SSR function if not a static asset
          { src: prerender ? "/(?<path>.*)" : "/.*", dest: prerender ? "/render?path=$path" : "/render" }
        ]
      };
      writeFileSync(join(outputDir, "config.json"), JSON.stringify(outputConfig, null, 2));

      // prerender config
      if (prerender) {
        const prerenderConfig = {
          "expiration": prerender?.expiration ?? false,
          "group": 1,
          "bypassToken": prerender?.bypassToken,
          "allowQuery": ["path"]
        };
        writeFileSync(join(outputDir, "functions/render.prerender-config.json"), JSON.stringify(prerenderConfig, null, 2));
      }
    }
  };
}

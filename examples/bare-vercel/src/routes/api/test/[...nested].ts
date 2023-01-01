import { APIEvent, json } from "solid-start";

export function GET(event: APIEvent) {
  return json({
    path: "/api/test/[...nested]",
    params: event.params
  });
}

export function POST() {
  return new Response("John Doe");
}

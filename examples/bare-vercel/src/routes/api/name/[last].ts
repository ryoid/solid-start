import { APIEvent, json } from "solid-start";

export function GET(event: APIEvent) {
  return json({
    path: "/api/name/[last]",
    params: event.params
  });
}

export function POST() {
  return new Response("John Doe");
}

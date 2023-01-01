import { APIEvent, json } from "solid-start";

export function GET(event: APIEvent) {
  return json({
    message: "John Doe"
  });
}

export function POST() {
  return new Response("John Doe");
}

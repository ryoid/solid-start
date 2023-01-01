import { APIEvent } from "solid-start";

export function GET(event: APIEvent) {
  console.log(event);
  return new Response("John Doe");
}

export function POST() {
  return new Response("John Doe");
}

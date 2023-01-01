import { json } from "solid-start";

export function GET() {
  return json({
    message: "John Doe"
  });
}

import { randomUUID } from "node:crypto";
import type { ServerResponse } from "node:http";
import type { Block } from "../capture/extract.js";
export function respond(
  res: ServerResponse,
  model: string,
  stream: boolean,
  content: Block[],
) {
  const stop = content.some((b) => b.type === "tool_use")
    ? "tool_use"
    : "end_turn";
  const message = {
    id: "msg_" + randomUUID(),
    type: "message",
    role: "assistant",
    model,
    content,
    stop_reason: stop,
    stop_sequence: null,
    usage: { input_tokens: 100, output_tokens: 20 },
  };
  if (!stream) {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(message));
    return;
  }
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
  });
  const event = (type: string, fields: object) =>
    res.write(
      "event: " +
        type +
        "\ndata: " +
        JSON.stringify({ type, ...fields }) +
        "\n\n",
    );
  event("message_start", {
    message: {
      ...message,
      content: [],
      stop_reason: null,
      usage: { input_tokens: 100, output_tokens: 0 },
    },
  });
  content.forEach((b, index) => {
    event("content_block_start", {
      index,
      content_block:
        b.type === "text"
          ? { type: "text", text: "" }
          : { type: "tool_use", id: b.id, name: b.name, input: {} },
    });
    event("content_block_delta", {
      index,
      delta:
        b.type === "text"
          ? { type: "text_delta", text: b.text }
          : { type: "input_json_delta", partial_json: JSON.stringify(b.input) },
    });
    event("content_block_stop", { index });
  });
  event("message_delta", {
    delta: { stop_reason: stop, stop_sequence: null },
    usage: { output_tokens: 20 },
  });
  event("message_stop", {});
  res.end();
}

import { ParcelError } from "../fixtures/loader.js";
export interface Block {
  type: string;
  text?: string;
  tool_use_id?: string;
  is_error?: boolean;
  content?: string | Block[];
  id?: string;
  name?: string;
  input?: unknown;
}
export interface Message {
  role: "user" | "assistant";
  content: string | Block[];
}
export interface RequestBody {
  model: string;
  stream?: boolean;
  messages: Message[];
  tools?: { name: string }[];
}
export function validateRequest(x: unknown): RequestBody {
  if (!x || typeof x !== "object")
    throw new ParcelError("protocol", "Expected Messages request");
  const q = x as RequestBody;
  if (!Array.isArray(q.messages) || typeof q.model !== "string")
    throw new ParcelError("protocol", "Missing Messages fields");
  for (const m of q.messages) {
    if (!["user", "assistant"].includes(m.role))
      throw new ParcelError("unsupported-protocol", "Unknown role");
    if (typeof m.content === "string") continue;
    if (!Array.isArray(m.content))
      throw new ParcelError("protocol", "Invalid content");
    for (const b of m.content) {
      if (!["text", "tool_use", "tool_result"].includes(b.type))
        throw new ParcelError(
          "unsupported-protocol",
          "Unmeasured protocol block: " + String(b.type),
        );
      if (b.type === "text" && typeof b.text !== "string")
        throw new ParcelError("protocol", "Invalid text block");
      if (b.type === "tool_result" && typeof b.tool_use_id !== "string")
        throw new ParcelError("protocol", "Missing tool-use ID");
      if (
        b.type === "tool_result" &&
        Array.isArray(b.content) &&
        b.content.some((c) => c.type !== "text" || typeof c.text !== "string")
      )
        throw new ParcelError(
          "unsupported-protocol",
          "Unknown nested tool-result block",
        );
    }
  }
  return q;
}
export function bodyBlock(q: RequestBody, skillPath: string) {
  const prefix = "Base directory for this skill: " + skillPath + "\n\n";
  const candidates = q.messages.flatMap((m, messageIndex) =>
    m.role === "user"
      ? typeof m.content === "string"
        ? []
        : m.content.flatMap((b, blockIndex) =>
            b.type === "text" && b.text?.startsWith(prefix)
              ? [
                  {
                    text: b.text.slice(prefix.length),
                    messageIndex,
                    blockIndex,
                  },
                ]
              : [],
          )
      : [],
  );
  if (candidates.length !== 1)
    throw new ParcelError(
      "body-unobserved",
      "Exactly one native skill body block must be observed in the first request",
    );
  return candidates[0]!;
}
export function toolResult(q: RequestBody, id: string) {
  const results = q.messages.flatMap((m, messageIndex) =>
    m.role === "user" && Array.isArray(m.content)
      ? m.content.flatMap((b, blockIndex) =>
          b.type === "tool_result" && b.tool_use_id === id
            ? [{ block: b, messageIndex, blockIndex }]
            : [],
        )
      : [],
  );
  if (results.length !== 1)
    throw new ParcelError(
      "read-succeeded-but-not-transmitted",
      "Read result was not uniquely transmitted",
    );
  return results[0]!;
}
export function resultText(b: Block): string {
  if (typeof b.content === "string") return b.content;
  if (
    Array.isArray(b.content) &&
    b.content.every((c) => c.type === "text" && typeof c.text === "string")
  )
    return b.content.map((c) => c.text).join("");
  throw new ParcelError(
    "unsupported-protocol",
    "Unknown native Read content encoding",
  );
}
export function readFragment(text: string) {
  const lines = text.split("\n");
  let expected = 1;
  const values = lines.map((line) => {
    const match = /^(\d+)\t([\s\S]*)$/.exec(line);
    if (!match || Number(match[1]) !== expected++)
      throw new ParcelError(
        "unsupported-read-wrapper",
        "Unknown Read wrapper; expected contiguous N<TAB>line",
      );
    return match[2]!;
  });
  return values.join("\n");
}

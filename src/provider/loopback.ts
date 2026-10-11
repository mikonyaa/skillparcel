import { createServer } from "node:http";
import type { Server } from "node:http";
import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { validateRequest } from "../capture/extract.js";
import type { RequestBody, Block } from "../capture/extract.js";
import { ParcelError, hash } from "../fixtures/loader.js";
import { respond } from "./messages-protocol.js";
export interface Capture {
  ordinal: number;
  bytes: number;
  privateDigest: string;
  body: RequestBody;
}
export async function startEndpoint(options: {
  credential: string;
  requestBytes: number;
  turns: number;
  privateDir?: string;
  onRequest: (q: Capture) => Block[];
  onFault: (e: ParcelError) => void;
}) {
  let ordinal = 0,
    total = 0;
  const digests: Capture[] = [];
  let fault: ParcelError | undefined;
  const server: Server = createServer(async (req, res) => {
    try {
      if (
        req.method !== "POST" ||
        req.headers["x-api-key"] !== options.credential
      ) {
        res.writeHead(401);
        res.end();
        return;
      }
      if (
        ![
          "/v1/messages",
          "/v1/messages?beta=true",
          "/v1/messages/count_tokens",
          "/v1/messages/count_tokens?beta=true",
        ].includes(req.url ?? "")
      )
        throw new ParcelError("unsupported-route", "Unexpected loopback route");
      let bytes = 0;
      const chunks: Buffer[] = [];
      for await (const c of req) {
        const b = Buffer.from(c as Uint8Array);
        bytes += b.length;
        total += b.length;
        if (
          bytes > options.requestBytes ||
          total > options.requestBytes * options.turns
        )
          throw new ParcelError(
            "request-limit",
            "HTTP capture byte budget exceeded",
          );
        chunks.push(b);
      }
      const raw = Buffer.concat(chunks);
      const parsed = JSON.parse(
        new TextDecoder("utf8", { fatal: true }).decode(raw),
      );
      if (req.url?.includes("/count_tokens")) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end('{"input_tokens":100}');
        return;
      }
      if (++ordinal > options.turns)
        throw new ParcelError(
          "turn-limit",
          "Model request turn budget exceeded",
        );
      const body = validateRequest(parsed),
        capture = { ordinal, bytes, privateDigest: hash(raw), body };
      digests.push(capture);
      if (options.privateDir) {
        await mkdir(options.privateDir, { recursive: true, mode: 0o700 });
        await writeFile(
          join(options.privateDir, "request-" + ordinal + ".json"),
          raw,
          { mode: 0o600, flag: "wx" },
        );
      }
      respond(
        res,
        body.model,
        Boolean(body.stream),
        options.onRequest(capture),
      );
    } catch (e) {
      fault =
        e instanceof ParcelError
          ? e
          : new ParcelError("protocol", "Invalid HTTP Messages request");
      if (!res.headersSent)
        res.writeHead(400, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          type: "error",
          error: {
            type: "invalid_request_error",
            message: "SkillParcel local capture gate stopped",
          },
        }),
      );
      options.onFault(fault);
    }
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 5000;
  server.maxHeadersCount = 40;
  server.on("clientError", (_e, socket) => socket.destroy());
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Missing loopback port");
  return {
    url: "http://127.0.0.1:" + address.port,
    captures: digests,
    get fault() {
      return fault;
    },
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

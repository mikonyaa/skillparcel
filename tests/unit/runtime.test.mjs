import test from "node:test";
import assert from "node:assert/strict";
import { startEndpoint } from "../../dist/provider/loopback.js";
import { runProcess } from "../../dist/native/process.js";
const endpoint = (overrides = {}) =>
  startEndpoint({
    credential: "synthetic-only",
    requestBytes: 1024,
    turns: 2,
    onRequest: () => [
      { type: "text", text: "Original synthetic endpoint response" },
    ],
    onFault: () => {},
    ...overrides,
  });
const post = (url, body, key = "synthetic-only") =>
  fetch(url + "/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
test("loopback is credential-gated, streams proper SSE frames and never reflects client text", async () => {
  const ep = await endpoint();
  try {
    assert.match(ep.url, /^http:\/\/127\.0\.0\.1:/);
    assert.equal(
      (await post(ep.url, { model: "x", messages: [] }, "wrong")).status,
      401,
    );
    const response = await post(ep.url, {
      model: "x",
      stream: true,
      messages: [{ role: "user", content: "private-client-sentinel" }],
    });
    const text = await response.text();
    const frames = text
      .trim()
      .split("\n\n")
      .map((frame) => {
        const data = frame.split("\n").find((l) => l.startsWith("data: "));
        return JSON.parse(data.slice(6));
      });
    assert.equal(frames[0].type, "message_start");
    assert.equal(frames.at(-1).type, "message_stop");
    assert.equal(text.includes("private-client-sentinel"), false);
    assert.equal(ep.captures.length, 1);
  } finally {
    await ep.close();
  }
});
test("oversized HTTP, too many turns and unknown blocks stop the gate", async () => {
  for (const [body, code] of [
    [
      { model: "x", messages: [{ role: "user", content: "x".repeat(1200) }] },
      "request-limit",
    ],
    [
      {
        model: "x",
        messages: [{ role: "user", content: [{ type: "image" }] }],
      },
      "unsupported-protocol",
    ],
  ]) {
    const ep = await endpoint();
    try {
      assert.equal((await post(ep.url, body)).status, 400);
      assert.equal(ep.fault.code, code);
    } finally {
      await ep.close();
    }
  }
  const ep = await endpoint({ turns: 1 });
  try {
    await post(ep.url, { model: "x", messages: [] });
    assert.equal(
      (await post(ep.url, { model: "x", messages: [] })).status,
      400,
    );
    assert.equal(ep.fault.code, "turn-limit");
  } finally {
    await ep.close();
  }
});
test("two owned endpoints use unique ports; closing one leaves the other available", async () => {
  const [a, b] = await Promise.all([endpoint(), endpoint()]);
  assert.notEqual(a.url, b.url);
  await a.close();
  try {
    assert.equal((await post(b.url, { model: "x", messages: [] })).status, 200);
  } finally {
    await b.close();
  }
});
test("process JSONL decoder preserves UTF-8 split across writes", async () => {
  const code = `const bytes=Buffer.from(JSON.stringify({type:'user',message:{content:[{type:'tool_result',tool_use_id:'id',content:'Привет 世界 👋'}]}})+'\\n');let i=0;function send(){if(i<bytes.length){process.stdout.write(bytes.subarray(i,i+1));i++;setImmediate(send);}else console.log(JSON.stringify({type:'result',subtype:'success',is_error:false}));}send();`;
  const result = await runProcess(
    process.execPath,
    ["-e", code],
    process.cwd(),
    {},
    5000,
  );
  assert.equal(result.events[0].message.content[0].content, "Привет 世界 👋");
});
test("timeout, cancellation and crash terminate only the spawned test child", async () => {
  await assert.rejects(
    runProcess(
      process.execPath,
      ["-e", "setInterval(()=>{},100)"],
      process.cwd(),
      {},
      80,
    ),
    (e) => e.code === "timeout",
  );
  const abort = new AbortController();
  const promise = runProcess(
    process.execPath,
    ["-e", "setInterval(()=>{},100)"],
    process.cwd(),
    {},
    5000,
    abort.signal,
  );
  setTimeout(() => abort.abort(), 80);
  await assert.rejects(promise, (e) => e.code === "cancelled");
  await assert.rejects(
    runProcess(
      process.execPath,
      ["-e", "process.exit(7)"],
      process.cwd(),
      {},
      5000,
    ),
    (e) => e.code === "native-crash",
  );
});
test("malformed native output and unknown events cannot silently pass", async () => {
  for (const code of [
    'console.log("not-json")',
    'console.log(JSON.stringify({type:"unknown"}))',
  ])
    await assert.rejects(
      runProcess(process.execPath, ["-e", code], process.cwd(), {}, 5000),
      (e) => ["native-output", "unsupported-native-event"].includes(e.code),
    );
});

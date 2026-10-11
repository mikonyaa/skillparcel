import test from "node:test";
import assert from "node:assert/strict";
import {
  readFile,
  mkdtemp,
  cp,
  writeFile,
  symlink,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compare, occurrences } from "../../dist/contracts/compare.js";
import {
  loadFixture,
  assertNoDrift,
  contained,
  select,
  decode,
} from "../../dist/fixtures/loader.js";
import { fixtureSchema } from "../../dist/fixtures/schema.js";
import {
  bodyBlock,
  validateRequest,
  toolResult,
  readFragment,
} from "../../dist/capture/extract.js";
import { nativeEnvironment } from "../../dist/native/isolation.js";
import { identify } from "../../dist/native/identity.js";
import { exitPriority } from "../../dist/run.js";
import { safeJson, html } from "../../dist/report/html.js";
import { reportSchema } from "../../dist/report/json.js";
import { junit } from "../../dist/report/junit.js";
const exact = {
  mode: "exact-text",
  normalization: "none",
  expectedOccurrences: 1,
};
test("exact contracts detect real one-character, whitespace and Unicode mutations", () => {
  for (const text of ["x $B$6", "Привет 世界 👋 e\u0301", "line\n\nend"]) {
    assert.equal(compare(text, text, exact).pass, true);
    assert.equal(compare(text + " ", text, exact).pass, false);
  }
  assert.equal(compare("é", "e\u0301", exact).pass, false);
  assert.equal(compare("", "", exact).pass, true);
  assert.equal(compare(" ", "", exact).pass, false);
});
test("CRLF raw verdict survives explicit normalization; no folding by default", () => {
  const r = compare("a\nb\n", "a\r\nb\r\n", {
    ...exact,
    normalization: "crlf-to-lf",
  });
  assert.equal(r.pass, true);
  assert.equal(r.rawPass, false);
  assert.equal(compare("a\nb", "a\r\nb", exact).pass, false);
  assert.equal(
    compare("a\rb", "a\nb", { ...exact, normalization: "crlf-to-lf" }).pass,
    false,
  );
});
test("contains counts are non-overlapping and confined to selected fragment", () => {
  assert.equal(occurrences("xx xx", "xx"), 2);
  assert.equal(
    compare("xx xx", "xx", {
      ...exact,
      mode: "contains-exact",
      expectedOccurrences: 2,
    }).pass,
    true,
  );
  assert.equal(
    compare("xx xx xx", "xx", {
      ...exact,
      mode: "contains-exact",
      expectedOccurrences: 2,
    }).pass,
    false,
  );
});
test("fixture strict schema rejects traversal, duplicate IDs, zero checks and unknown settings", async () => {
  const f = JSON.parse(
    await readFile("fixtures/literal/skillparcel.case.json", "utf8"),
  );
  assert.ok(fixtureSchema.safeParse(f).success);
  for (const edit of [
    (x) => (x.checks = []),
    (x) => (x.hooks = {}),
    (x) => (x.skillDirectory = "../escape"),
    (x) => x.checks.push(x.checks[0]),
    (x) => (x.referenceRead = { path: "/etc/passwd" }),
    (x) => (x.checks[0].expectedFile = "a"),
  ]) {
    const x = structuredClone(f);
    edit(x);
    assert.equal(fixtureSchema.safeParse(x).success, false);
  }
});
test("source selectors require unique ordered sentinels and valid UTF-8 boundaries", () => {
  assert.equal(
    select("beginend", { sentinels: { begin: "begin", end: "end" } }),
    "",
  );
  assert.throws(() =>
    select("begin x begin y end", {
      sentinels: { begin: "begin", end: "end" },
    }),
  );
  assert.throws(() =>
    select("é", { sourceRange: { startByte: 1, endByte: 2 } }),
  );
  assert.throws(() => decode(Buffer.from([0xff])));
  assert.equal(decode(Buffer.from("\ufeffX")), "\ufeffX");
});
test("loader hashes actual bytes, catches drift, rejects dynamic execution and unsupported frontmatter", async () => {
  const root = await mkdtemp(join(tmpdir(), "sp-unit-"));
  try {
    await cp("fixtures/literal", root, { recursive: true });
    const loaded = await loadFixture(root);
    await assertNoDrift(loaded);
    const path = join(root, "skill/literal/SKILL.md"),
      text = await readFile(path, "utf8");
    await writeFile(path, text + "changed");
    await assert.rejects(
      assertNoDrift(loaded),
      (e) => e.code === "source-drift",
    );
    await writeFile(path, text + "\n!`echo forbidden`");
    await assert.rejects(
      loadFixture(root),
      (e) => e.code === "dynamic-execution",
    );
    await writeFile(path, text.replace("description:", "hooks:"));
    await assert.rejects(loadFixture(root), (e) => e.code === "frontmatter");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("realpath containment rejects symlinks and ambiguous spelling", async () => {
  const root = await mkdtemp(join(tmpdir(), "sp-path-"));
  try {
    await writeFile(join(root, "A.txt"), "text");
    await symlink("/etc/passwd", join(root, "link"));
    await assert.rejects(contained(root, "link"), (e) => e.code === "symlink");
    await assert.rejects(contained(root, "../escape"));
    await assert.rejects(
      contained(root, "a.txt"),
      (e) => e.code === "ambiguous-path",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("body identity rejects prompt arguments, assistant replies and duplicate native blocks", () => {
  const prefix = "Base directory for this skill: /own/skill\n\n";
  const q = {
    model: "synthetic",
    messages: [
      { role: "user", content: [{ type: "text", text: "/skill SP_SENTINEL" }] },
      {
        role: "assistant",
        content: [{ type: "text", text: prefix + "SP_SENTINEL" }],
      },
    ],
  };
  assert.throws(() => bodyBlock(q, "/own/skill"));
  q.messages[0].content.push({ type: "text", text: prefix + "SP_SENTINEL" });
  assert.equal(bodyBlock(q, "/own/skill").blockIndex, 1);
  q.messages[0].content.push({ type: "text", text: prefix + "SP_SENTINEL" });
  assert.throws(() => bodyBlock(q, "/own/skill"));
});
test("API blocks are JSON-unescaped; unknown type is unsupported, not ignored", () => {
  const q = validateRequest(
    JSON.parse(
      '{"model":"synthetic","messages":[{"role":"user","content":[{"type":"text","text":"\\u041f\\n世界 👋"}]}]}',
    ),
  );
  assert.equal(q.messages[0].content[0].text, "П\n世界 👋");
  assert.throws(
    () =>
      validateRequest({
        model: "x",
        messages: [{ role: "user", content: [{ type: "unknown" }] }],
      }),
    (e) => e.code === "unsupported-protocol",
  );
});
test("Read correlation uses exact tool ID; history and assistant blocks do not count", () => {
  const q = {
    model: "x",
    messages: [
      {
        role: "assistant",
        content: [
          { type: "tool_result", tool_use_id: "right", content: "fake" },
        ],
      },
      {
        role: "user",
        content: [
          { type: "tool_result", tool_use_id: "wrong", content: "old" },
          { type: "tool_result", tool_use_id: "right", content: "1\tnew\n2\t" },
        ],
      },
    ],
  };
  assert.equal(toolResult(q, "right").block.content, "1\tnew\n2\t");
  assert.throws(() => toolResult(q, "absent"));
  q.messages.push(q.messages[1]);
  assert.throws(() => toolResult(q, "right"));
});
test("declared Read-wrapper extraction preserves final newline and refuses unknown wrappers", () => {
  assert.equal(
    readFragment("1\tПривет\n2\t\n3\t世界 👋\n4\t"),
    "Привет\n\n世界 👋\n",
  );
  for (const value of ["raw", "2\tx", "1\tx\n3\ty", "1|x"])
    assert.throws(
      () => readFragment(value),
      (e) => e.code === "unsupported-read-wrapper",
    );
});
test("native child environment is an allowlist and preserves HOME without provider inheritance", () => {
  const e = nativeEnvironment(
    "/own",
    "/own/config",
    "http://127.0.0.1:1",
    "synthetic",
  );
  assert.equal(e.HOME, process.env.HOME);
  for (const key of [
    "CODEX_HOME",
    "NODE_OPTIONS",
    "ANTHROPIC_AUTH_TOKEN",
    "CLAUDE_CODE_OAUTH_TOKEN",
    "HTTPS_PROXY",
    "AWS_SECRET_ACCESS_KEY",
    "CLAUDE_CODE_USE_VERTEX",
  ])
    assert.equal(key in e, false);
  assert.equal(e.CLAUDE_CONFIG_DIR, "/own/config");
});
test("a CLI stand-in cannot receive native coverage", async () => {
  const dir = await mkdtemp(join(tmpdir(), "sp-shim-"));
  try {
    const shim = join(dir, "claude");
    await writeFile(shim, '#!/bin/sh\nprintf "2.1.280 (Claude Code)\\n"\n', {
      mode: 0o755,
    });
    await assert.rejects(identify(shim), (e) =>
      ["native-identity", "unsupported-platform"].includes(e.code),
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("exit aggregation never treats zero work as pass", () => {
  assert.equal(exitPriority([]), 3);
  assert.equal(exitPriority([1, 3, 2, 0]), 2);
  assert.equal(exitPriority([1, 3]), 3);
  assert.equal(exitPriority([0, 1]), 1);
  assert.equal(exitPriority([0, 130]), 130);
});
const empty = {
  schemaVersion: 1,
  toolVersion: "0.1.0",
  adapterVersion: "1.0.0",
  nativeVersion: "unmeasured",
  nativeSha256: "",
  OS: "portable",
  arch: "unmeasured",
  recordedAt: "2026-10-12T00:00:00Z",
  invocationMode: "portable report test",
  networkMode: "none",
  coverage: "portable-only",
  recorded: true,
  cases: [],
  exitCode: 3,
  omissions: ["No native measurement in this portable test"],
};
test("public report schema rejects raw request and vendor fields", () => {
  assert.ok(reportSchema.safeParse(empty).success);
  assert.equal(
    reportSchema.safeParse({ ...empty, rawRequest: "private" }).success,
    false,
  );
});
test("HTML JSON escaping neutralizes script termination, bidi/ANSI are text, output is offline", async () => {
  const attack = "</script><script>globalThis.ATTACK=1</script>";
  assert.ok(!safeJson(attack).includes("<"));
  const out = await html({ ...empty, omissions: [attack, "\u001b[31m"] });
  assert.ok(!out.includes("<script>globalThis.ATTACK"));
  assert.ok(out.includes("connect-src 'none'"));
  assert.ok(!out.includes('src="https://'));
  assert.ok(out.includes("No cases were measured"));
});
test("empty JUnit contains zero tests and report retains unsupported exit", () => {
  assert.match(junit(empty), /tests="0"/);
  assert.equal(empty.exitCode, 3);
});
test("all original corpus inputs validate before any native launch", async () => {
  for (const name of await (
    await import("node:fs/promises")
  ).readdir("fixtures")) {
    const loaded = await loadFixture(join("fixtures", name));
    assert.equal(loaded.fixtureHash.length, 64);
    assert.ok(loaded.checks.length);
    await assertNoDrift(loaded);
  }
});
test("missing reference is distinct from malformed schema", async () => {
  const root = await mkdtemp(join(tmpdir(), "sp-missing-"));
  try {
    await cp("fixtures/reference-read", root, { recursive: true });
    await rm(join(root, "skill/reference-read/references/proof.txt"));
    await assert.rejects(
      loadFixture(root),
      (e) => e.code === "missing-reference",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("unmeasured or empty reports cannot acquire a passing status", () => {
  assert.equal(
    reportSchema.safeParse({ ...empty, exitCode: 0 }).success,
    false,
  );
  const bad = {
    id: "no-checks",
    title: "Unmeasured",
    fixtureHash: "",
    outcome: "pass",
    measurementStatus: "complete",
    contractStatus: "pass",
    observedStages: ["body"],
    checks: [],
    limits: { inputBytes: 0, requestBytes: 0, turns: 0, timeoutMs: 0 },
    evidence: [],
    evidenceRefs: [],
    omissions: [],
  };
  assert.equal(
    reportSchema.safeParse({ ...empty, cases: [bad], exitCode: 0 }).success,
    false,
  );
});
test("unknown nested protocol blocks remain unsupported", () => {
  assert.throws(
    () =>
      validateRequest({
        model: "synthetic",
        messages: [
          {
            role: "user",
            content: [
              {
                type: "tool_result",
                tool_use_id: "id",
                content: [{ type: "image" }],
              },
            ],
          },
        ],
      }),
    (e) => e.code === "unsupported-protocol",
  );
});

test("bounded regular-file input refuses a FIFO before attempting to read it", async () => {
  const root = await mkdtemp(join(tmpdir(), "sp-fifo-"));
  try {
    const { spawnSync } = await import("node:child_process");
    const fifo = join(root, "case.json");
    assert.equal(spawnSync("/usr/bin/mkfifo", [fifo]).status, 0);
    const { boundedFile } = await import("../../dist/fixtures/loader.js");
    await assert.rejects(
      boundedFile(fifo, 1024),
      (e) => e.code === "input-limit",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

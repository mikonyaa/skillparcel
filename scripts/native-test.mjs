import { parseArgs } from "node:util";
import { promisify } from "node:util";
import { spawn, execFile } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { readFile, mkdir, writeFile, mkdtemp, cp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";
import { runCases } from "../dist/run.js";
import { discover } from "../dist/fixtures/loader.js";
import { serializeReport } from "../dist/report/json.js";
import { html } from "../dist/report/html.js";
import { junit } from "../dist/report/junit.js";
const { values } = parseArgs({
  options: { client: { type: "string" }, out: { type: "string" } },
});
if (!values.client)
  throw Error("test:native requires --client /absolute/path/to/claude");
const out = resolve(values.out ?? "work/native-evidence");
await mkdir(out, { recursive: true });
const expected = JSON.parse(
  await readFile("tests/native/expected-outcomes.json", "utf8"),
);
const dirs = await discover("fixtures");
const signatures = [];
let last;
for (let repeat = 1; repeat <= 3; repeat++) {
  const r = await runCases(dirs, values.client, {
    sourceCommit: process.env.SKILLPARCEL_SOURCE_COMMIT,
  });
  assert.equal(r.coverage, "native-verified");
  assert.equal(r.exitCode, 1);
  assert.equal(r.cases.length, 11);
  for (const c of r.cases) {
    assert.equal(
      c.outcome,
      expected[c.id],
      JSON.stringify({
        case: c.id,
        reason: c.reason,
        checks: c.checks.map((x) => ({ id: x.id, transmitted: x.transmitted })),
      }),
    );
    assert.equal(c.measurementStatus, "complete");
    assert.ok(
      c.isolation.cleanup &&
        c.isolation.excludedCanaryAbsent &&
        c.isolation.onlyExpectedTools,
    );
    assert.ok(c.evidence.some((e) => e.stage === "body-observed"));
  }
  const ref = r.cases.find((c) => c.id === "reference-read");
  assert.deepEqual(ref.observedStages, ["body", "reference-read"]);
  const nativeId = ref.evidence.find(
    (e) => e.stage === "read-executed",
  ).toolUseId;
  assert.equal(ref.checks[1].evidenceRef.toolUseId, nativeId);
  assert.equal(
    ref.evidence.find((e) => e.stage === "read-result-transmitted").toolUseId,
    nativeId,
  );
  assert.deepEqual(
    r.cases.find((c) => c.id === "reference-withheld").observedStages,
    ["body"],
  );
  signatures.push(
    JSON.stringify(
      r.cases.map((c) => ({
        id: c.id,
        outcome: c.outcome,
        checks: c.checks.map((x) => ({
          id: x.id,
          source: x.source,
          expected: x.expected,
          transmitted: x.transmitted,
          pass: x.pass,
          rawPass: x.rawPass,
        })),
      })),
    ),
  );
  await writeFile(join(out, "repeat-" + repeat + ".json"), serializeReport(r));
  last = r;
  console.log(
    `Native repetition ${repeat}: 11 cases, 9 pass, 2 expected measured violations; body + forced Read linked.`,
  );
}
assert.equal(signatures[0], signatures[1]);
assert.equal(signatures[0], signatures[2]);
const [parallelA, parallelB] = await Promise.all([
  runCases([resolve("fixtures/reference-read")], values.client),
  runCases([resolve("fixtures/reference-read")], values.client),
]);
assert.equal(parallelA.exitCode, 0);
assert.equal(parallelB.exitCode, 0);
assert.notEqual(
  parallelA.cases[0].checks[1].evidenceRef.toolUseId,
  parallelB.cases[0].checks[1].evidenceRef.toolUseId,
);
const negative = await mkdtemp(join(tmpdir(), "skillparcel-negative-"));
try {
  await cp("fixtures/reference-read", negative, { recursive: true });
  const file = join(negative, "skillparcel.case.json");
  const f = JSON.parse(await readFile(file, "utf8"));
  f.referenceRead.permission = "deny";
  await writeFile(file, JSON.stringify(f));
  const denied = await runCases([negative], values.client);
  assert.equal(denied.exitCode, 3);
  assert.equal(denied.cases[0].reasonCode, "read-denied");
  await writeFile(join(out, "denied-read.json"), serializeReport(denied));
  await rm(join(negative, f.referenceRead.path));
  const missing = await runCases([negative], values.client);
  assert.equal(missing.exitCode, 2);
  assert.equal(missing.cases[0].reasonCode, "missing-reference");
  await writeFile(
    join(out, "missing-reference.json"),
    serializeReport(missing),
  );
} finally {
  await rm(negative, { recursive: true, force: true });
}
const abort = new AbortController();
abort.abort();
const cancelled = await runCases([resolve("fixtures/literal")], values.client, {
  signal: abort.signal,
});
assert.equal(cancelled.exitCode, 130);
assert.equal(cancelled.cases[0].isolation.cleanup, true);
// Signal only the CLI spawned by this acceptance test, after its own endpoint
// starts listening. This tests the actual CLI SIGINT path with a native child.
const signalRoot = await mkdtemp(join(tmpdir(), "skillparcel-signal-test-"));
const signalChild = spawn(
  process.execPath,
  [
    resolve("dist/cli/main.js"),
    "demo",
    "--client",
    values.client,
    "--out",
    join(signalRoot, "results"),
    "--no-open",
  ],
  { shell: false, stdio: ["ignore", "pipe", "pipe"] },
);
let signalStdout = "";
signalChild.stdout.setEncoding("utf8");
signalChild.stdout.on("data", (b) => (signalStdout += b));
signalChild.stderr.resume();
const signalExit = new Promise((r, j) => {
  signalChild.once("error", j);
  signalChild.once("close", r);
});
try {
  let listening = false;
  const deadline = performance.now() + 10000;
  while (performance.now() < deadline && signalChild.exitCode === null) {
    const sockets = await promisify(execFile)(
      "/usr/sbin/lsof",
      [
        "-nP",
        "-a",
        "-p",
        String(signalChild.pid),
        "-iTCP",
        "-sTCP:LISTEN",
        "-Fn",
      ],
      { timeout: 1000, maxBuffer: 65536 },
    ).catch(() => ({ stdout: "" }));
    if (sockets.stdout.includes("n127.0.0.1:")) {
      listening = true;
      break;
    }
    await delay(25);
  }
  assert.equal(listening, true, "Owned CLI endpoint did not start");
  await delay(25);
  signalChild.kill("SIGINT");
  assert.equal(await signalExit, 130);
  assert.equal(JSON.parse(signalStdout).exitCode, 130);
  const interrupted = JSON.parse(
    await readFile(join(signalRoot, "results/report.json"), "utf8"),
  );
  assert.equal(interrupted.cases.at(-1).outcome, "cancelled");
  assert.equal(interrupted.cases.at(-1).isolation.cleanup, true);
  assert.ok(
    interrupted.cases.at(-1).evidence.some((e) => e.stage === "start-native"),
  );
  await writeFile(join(out, "sigint.json"), serializeReport(interrupted));
} finally {
  if (signalChild.exitCode === null && signalChild.signalCode === null) {
    signalChild.kill("SIGTERM");
    await delay(500);
    if (signalChild.exitCode === null && signalChild.signalCode === null)
      signalChild.kill("SIGKILL");
  }
  await signalExit;
  await rm(signalRoot, { recursive: true, force: true });
}
await writeFile(join(out, "report.json"), serializeReport(last));
await writeFile(join(out, "report.html"), await html(last));
await writeFile(join(out, "junit.xml"), junit(last));
await writeFile(
  join(out, "acceptance.json"),
  JSON.stringify(
    {
      verified: true,
      nativeVersion: last.nativeVersion,
      stableCases: 11,
      repetitions: 3,
      stable: true,
      parallelIndependent: true,
      deniedVsMissingDistinct: true,
      cancellationCleanup: true,
      sigintCleanup: true,
      sourceCommit: process.env.SKILLPARCEL_SOURCE_COMMIT ?? null,
    },
    null,
    2,
  ) + "\n",
);
console.log(
  "Native acceptance passed: stable corpus, independent parallel runs, denied/missing distinction and cancelled-run cleanup.",
);

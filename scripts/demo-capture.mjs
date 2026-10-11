import { parseArgs } from "node:util";
import { spawn } from "node:child_process";
import { readFile, writeFile, mkdir, mkdtemp, cp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";
const { values } = parseArgs({
  options: {
    client: { type: "string" },
    tarball: { type: "string" },
    out: { type: "string" },
  },
});
if (!values.client)
  throw Error("demo:capture requires --client /absolute/path/to/claude");
const out = resolve(values.out ?? "work/demo-capture");
await mkdir(out, { recursive: true });
const root = await mkdtemp(join(tmpdir(), "skillparcel-demo-consumer-"));
const run = async (exe, args, expected) => {
  const child = spawn(exe, args, {
    cwd: root,
    shell: false,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "",
    stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (b) => {
    stdout += b;
    if (recording) record(b);
  });
  child.stderr.on("data", (b) => (stderr += b));
  const exit = await new Promise((r, j) => {
    child.on("error", j);
    child.on("close", r);
  });
  assert.equal(exit, expected, stderr);
  return stdout;
};
let recording = false,
  started = 0;
const frames = [];
const record = (text) =>
  frames.push([(performance.now() - started) / 1000, "o", text]);
try {
  await writeFile(
    join(root, "package.json"),
    '{"private":true,"type":"module"}\n',
  );
  let archive = values.tarball ? resolve(values.tarball) : null;
  if (!archive) {
    await mkdir("work/demo-pack", { recursive: true });
    const pack = spawn(
      "npm",
      ["pack", "--json", "--pack-destination", "work/demo-pack"],
      { shell: false, stdio: ["ignore", "pipe", "inherit"] },
    );
    let text = "";
    pack.stdout.on("data", (b) => (text += b));
    assert.equal(await new Promise((r) => pack.on("close", r)), 0);
    archive = resolve("work/demo-pack", JSON.parse(text)[0].filename);
  }
  await run(
    "npm",
    [
      "install",
      "--omit=dev",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      archive,
    ],
    0,
  );
  const bin = join(root, "node_modules/skillparcel/dist/cli/main.js");
  const source = await readFile(
    join(
      root,
      "node_modules/skillparcel/fixtures/dollar-digit/skill/dollar-digit/SKILL.md",
    ),
    "utf8",
  );
  started = performance.now();
  recording = true;
  record(
    "SkillParcel 0.1.0 · original synthetic captured native run\r\nDate: " +
      new Date().toISOString() +
      " · Claude Code 2.1.280 · macOS arm64\r\n\r\n$ cat fixtures/dollar-digit/skill/dollar-digit/SKILL.md\r\n" +
      source.replaceAll("\n", "\r\n") +
      '\r\n$ skillparcel demo --client "$CLAUDE" --out ./live-results --no-open\r\n',
  );
  await run(
    process.execPath,
    [
      bin,
      "demo",
      "--client",
      values.client,
      "--out",
      "./live-results",
      "--no-open",
    ],
    1,
  );
  const report = JSON.parse(
    await readFile(join(root, "live-results/report.json"), "utf8"),
  );
  assert.equal(report.coverage, "native-verified");
  const dollar = report.cases.find((c) => c.id === "dollar-digit");
  assert.equal(dollar.outcome, "violation");
  record(
    "\r\nMeasured author contract / expected:\r\n" +
      dollar.checks[0].expected.replaceAll("\n", "\r\n") +
      "Transmitted first native API body fragment:\r\n" +
      dollar.checks[0].transmitted.replaceAll("\n", "\r\n"),
  );
  const ref = report.cases.find((c) => c.id === "reference-read");
  assert.deepEqual(ref.observedStages, ["body", "reference-read"]);
  record(
    "\r\nForced native Read path:\r\n" +
      ref.evidence
        .filter((e) =>
          [
            "body-observed",
            "optional-read-requested",
            "read-executed",
            "read-result-transmitted",
          ].includes(e.stage),
        )
        .map((e) => JSON.stringify(e))
        .join("\r\n") +
      "\r\nReference transmitted:\r\n" +
      ref.checks[1].transmitted.replaceAll("\n", "\r\n") +
      "\r\n",
  );
  const delay = Math.max(0, 25000 - (performance.now() - started));
  await new Promise((r) => setTimeout(r, delay));
  record(
    "Capture complete. Exit 1 correctly reports two measured contract violations.\r\n",
  );
  recording = false;
  await cp(join(root, "live-results/report.json"), join(out, "report.json"));
  await cp(join(root, "live-results/report.html"), join(out, "report.html"));
  const header = {
    version: 2,
    width: 112,
    height: 32,
    timestamp: Math.floor(Date.now() / 1000),
    env: { SHELL: "/bin/sh", TERM: "xterm-256color" },
    title: "SkillParcel 0.1.0 · synthetic captured native run",
  };
  await writeFile(
    join(out, "demo.cast"),
    [JSON.stringify(header), ...frames.map((f) => JSON.stringify(f))].join(
      "\n",
    ) + "\n",
  );
  await writeFile(
    join(out, "demo-metadata.json"),
    JSON.stringify(
      {
        durationSeconds: frames.at(-1)[0],
        nativeVersion: report.nativeVersion,
        sourceCommit: report.sourceCommit ?? null,
        recording:
          "Actual installed tarball CLI stdout plus source/decoded own fragments; final screen held to 25 seconds",
        rawVendorContent: false,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    JSON.stringify({
      recorded: true,
      durationSeconds: frames.at(-1)[0],
      installedTarball: true,
      nativeVersion: report.nativeVersion,
    }),
  );
} finally {
  await rm(root, { recursive: true, force: true });
}

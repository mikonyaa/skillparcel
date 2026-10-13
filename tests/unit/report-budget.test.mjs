import test from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile, mkdtemp, rm, lstat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { serializeReport, reportSchema } from "../../dist/report/json.js";
import { junit } from "../../dist/report/junit.js";
import { budgets } from "../../dist/budgets.js";
import { readReport } from "../../dist/report/reader.js";
import { saveBundle } from "../../dist/report/bundle.js";
import { BudgetError } from "../../dist/errors.js";

async function syntheticReport() {
  const report = JSON.parse(await readFile("examples/report.json", "utf8"));
  report.coverage = "portable-only";
  report.recorded = true;
  report.nativeVersion = "unmeasured";
  report.nativeSha256 = "";
  delete report.sourceCommit;
  return report;
}

test("SP-1: a writer-accepted 20-case report is readable by the installed CLI", async () => {
  const report = await syntheticReport();
  const item = report.cases.find((c) => c.outcome === "pass");
  const text = "x".repeat(131072);
  const check = {
    ...item.checks[0],
    source: text,
    expected: text,
    transmitted: text,
    diff: [{ kind: "equal", text }],
  };
  report.cases = Array.from({ length: 20 }, (_, i) => ({
    ...item,
    id: "synthetic-large-" + i,
    checks: [check],
  }));
  report.exitCode = 0;
  assert.equal(reportSchema.safeParse(report).success, true);
  const json = serializeReport(report);
  assert.ok(Buffer.byteLength(json) > 8 * 1024 * 1024);
  const root = await mkdtemp(join(tmpdir(), "sp-roundtrip-"));
  try {
    await writeFile(join(root, "report.json"), json);
    const result = spawnSync(
      process.execPath,
      [
        resolve("dist/cli/main.js"),
        "report",
        join(root, "report.json"),
        "--out",
        join(root, "report.html"),
      ],
      { encoding: "utf8", timeout: 30000 },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.match(
      await readFile(join(root, "report.html"), "utf8"),
      /synthetic-large-19/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

for (const [name, pattern] of [
  ["ASCII", "a"],
  ["multibyte UTF-8", "é世界👋"],
]) {
  test(`aggregate boundary on ${name}: accepted writer output reads; rejected output makes no bundle`, async () => {
    const root = await mkdtemp(join(tmpdir(), "sp-boundary-"));
    try {
      const report = await syntheticReport();
      report.cases = [];
      report.exitCode = 3;
      report.networkMode = "";
      const overhead = Buffer.byteLength(
        JSON.stringify(report, null, 2) + "\n",
      );
      const unit = Buffer.byteLength(pattern);
      for (const delta of [-1, 0, 1]) {
        const target = budgets.reportBytes + delta;
        const count = target - overhead;
        report.networkMode =
          pattern.repeat(Math.floor(count / unit)) + "a".repeat(count % unit);
        assert.equal(
          Buffer.byteLength(JSON.stringify(report, null, 2) + "\n"),
          target,
        );
        if (delta <= 0) {
          const json = serializeReport(report);
          assert.equal(Buffer.byteLength(json), target);
          const file = join(root, "accepted.json");
          await writeFile(file, json);
          assert.equal(
            (await readReport(file)).networkMode,
            report.networkMode,
          );
        } else {
          const rejects = (error) =>
            error instanceof BudgetError && error.code === "report-limit";
          assert.throws(() => serializeReport(report), rejects);
          const out = join(root, "rejected bundle");
          await assert.rejects(saveBundle(report, out), rejects);
          await assert.rejects(lstat(out), { code: "ENOENT" });
          const file = join(root, "too-large.json");
          await writeFile(file, JSON.stringify(report, null, 2) + "\n");
          await assert.rejects(
            readReport(file),
            (error) => error.code === "input-limit",
          );
        }
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
}

test("report reader rejects malformed UTF-8 rather than silently replacing evidence", async () => {
  const root = await mkdtemp(join(tmpdir(), "sp-report-utf8-"));
  try {
    const report = await syntheticReport();
    const json = serializeReport(report);
    const file = join(root, "invalid.json");
    await writeFile(
      file,
      Buffer.concat([
        Buffer.from(json.slice(0, -2)),
        Buffer.from([0xff]),
        Buffer.from("}\n"),
      ]),
    );
    await assert.rejects(
      readReport(file),
      (error) => error.code === "report-json",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("SP-2: independent XML 1.0 parser accepts noncharacters, controls and lone surrogates", async () => {
  const report = await syntheticReport();
  const text = 'A\ufffe\uffff\u0000\ud800Z\udfffB\t\n\rПривет 世界 👋 &<>"';
  report.cases = [report.cases.find((c) => c.outcome === "violation")];
  report.exitCode = 1;
  report.cases[0].id = text;
  report.cases[0].checks[0].id = text;
  report.cases[0].checks[0].expected = text;
  report.cases[0].checks[0].transmitted = text + "changed";
  assert.equal(reportSchema.safeParse(report).success, true);
  assert.equal(
    JSON.parse(serializeReport(report)).cases[0].checks[0].expected,
    text,
  );
  const parsed = spawnSync(
    "python3",
    [
      "-c",
      "import sys,xml.etree.ElementTree as ET; r=ET.fromstring(sys.stdin.buffer.read()); assert '👋' in r.find('testcase/failure').text; print('valid XML 1.0')",
    ],
    { input: junit(report), encoding: "utf8" },
  );
  assert.equal(parsed.status, 0, parsed.stderr);
});

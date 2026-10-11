#!/usr/bin/env node
import { parseArgs } from "node:util";
import { readFile, writeFile, mkdir, cp, readdir, rm } from "node:fs/promises";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { identify } from "../native/identity.js";
import { discover, ParcelError, boundedFile } from "../fixtures/loader.js";
import { runCases, TOOL_VERSION } from "../run.js";
import { html } from "../report/html.js";
import { junit } from "../report/junit.js";
import { reportSchema, serializeReport } from "../report/json.js";
import type { Report } from "../report/json.js";
const packageRoot = fileURLToPath(new URL("../../", import.meta.url));
const help = `SkillParcel ${TOOL_VERSION} — test what native Claude Code loads from your skills.
Usage:
 skillparcel --version
 skillparcel doctor --client /absolute/path/to/claude --json
 skillparcel init --dir ./parcel-example
 skillparcel run ./parcel-example --client /absolute/path/to/claude --out ./parcel-results
 skillparcel run ./parcel-example --client /absolute/path/to/claude --format junit --no-open
 skillparcel demo --client /absolute/path/to/claude --out ./demo-results
 skillparcel demo --recorded --out ./recorded-results
 skillparcel report ./parcel-results/report.json --out ./report.html
Options: --json, --format json|junit|html, --no-open, --allow-unverified-client,
 --private-capture DIR (explicit local raw bytes, mode 0600; delete DIR after diagnosis).
Native runs require the separately installed signed macOS arm64 Claude Code 2.1.280 build.
Recorded mode only views historical evidence. No inference model or paid provider is used.
Exit: 0 pass; 1 measured violation; 2 error; 3 unsupported/unmeasured; 130 cancelled.
`;
async function outputDirectory(dir: string) {
  const path = resolve(dir);
  await mkdir(dirname(path), { recursive: true });
  try {
    await mkdir(path, { recursive: false });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
    if ((await readdir(path)).length)
      throw new ParcelError(
        "output-exists",
        "Use a new or empty output directory",
      );
  }
  await writeFile(
    join(path, ".skillparcel-output-lock"),
    "Owned SkillParcel output reservation\n",
    { flag: "wx" },
  );
  return path;
}
async function save(report: Report, out: string) {
  const dir = await outputDirectory(out);
  for (const [name, text] of [
    ["report.json", serializeReport(report)],
    ["report.html", await html(report)],
    ["junit.xml", junit(report)],
  ])
    await writeFile(join(dir, name!), text!, { flag: "wx" });
  await rm(join(dir, ".skillparcel-output-lock"));
  return dir;
}
async function main() {
  const parsed = parseArgs({
    allowPositionals: true,
    options: {
      help: { type: "boolean", short: "h" },
      version: { type: "boolean", short: "v" },
      client: { type: "string" },
      dir: { type: "string" },
      out: { type: "string" },
      format: { type: "string" },
      json: { type: "boolean" },
      "no-open": { type: "boolean" },
      recorded: { type: "boolean" },
      "allow-unverified-client": { type: "boolean" },
      "private-capture": { type: "string" },
    },
  });
  const v = parsed.values,
    command = parsed.positionals[0];
  if (v.version) {
    console.log(TOOL_VERSION);
    return;
  }
  if (v.help || !command) {
    console.log(help);
    return;
  }
  if (!["doctor", "init", "run", "demo", "report"].includes(command))
    throw new ParcelError("command", "Unknown command; use --help");
  if (v.format && !["json", "junit", "html"].includes(v.format))
    throw new ParcelError("format", "Use json, junit or html");
  if (command === "init") {
    if (!v.dir) throw new ParcelError("input", "init requires --dir");
    const dir = await outputDirectory(v.dir);
    const template = join(packageRoot, "templates/parcel-example");
    for (const entry of await readdir(template))
      await cp(join(template, entry), join(dir, entry), {
        recursive: true,
        errorOnExist: true,
        force: false,
      });
    await rm(join(dir, ".skillparcel-output-lock"));
    console.log(JSON.stringify({ initialized: true, directory: dir }));
    return;
  }
  if (command === "doctor") {
    try {
      if (!v.client)
        throw new ParcelError(
          "missing-client",
          "Pass --client /absolute/path/to/claude; install the official native CLI if absent",
        );
      const { identity } = await identify(
        v.client,
        Boolean(v["allow-unverified-client"]),
      );
      console.log(
        JSON.stringify({
          toolVersion: TOOL_VERSION,
          ...identity,
          status: identity.verified ? "supported" : "unsupported",
        }),
      );
      process.exitCode = identity.verified ? 0 : 3;
    } catch (e) {
      const error =
        e instanceof ParcelError
          ? e
          : new ParcelError("doctor", "Native identity check failed");
      console.log(
        JSON.stringify({
          status: "unsupported",
          reasonCode: error.code,
          reason: error.message,
        }),
      );
      process.exitCode = error.code === "missing-client" ? 2 : 3;
    }
    return;
  }
  if (command === "report") {
    const input = parsed.positionals[1];
    if (!input || !v.out)
      throw new ParcelError(
        "input",
        "report requires a report JSON path and --out file",
      );
    const bytes = await boundedFile(resolve(input), 8 * 1024 * 1024);
    if (bytes.length > 8 * 1024 * 1024)
      throw new ParcelError("input-limit", "Report exceeds 8 MiB");
    const report = reportSchema.parse(JSON.parse(bytes.toString("utf8")));
    await writeFile(resolve(v.out), await html(report), { flag: "wx" });
    console.log(JSON.stringify({ rendered: true }));
    return;
  }
  let report: Report;
  if (command === "demo" && v.recorded) {
    report = reportSchema.parse(
      JSON.parse(
        await readFile(join(packageRoot, "examples/report.json"), "utf8"),
      ),
    );
    report.recorded = true;
    report.coverage =
      report.coverage === "native-verified"
        ? "native-verified"
        : report.coverage;
  } else {
    if (v.recorded)
      throw new ParcelError("input", "--recorded is only available for demo");
    if (!v.client)
      throw new ParcelError(
        "missing-client",
        "Native run requires --client /absolute/path/to/claude. It never opens login",
      );
    const dir =
      command === "demo"
        ? join(packageRoot, "fixtures")
        : parsed.positionals[1];
    if (!dir)
      throw new ParcelError(
        "input",
        "run requires an intentional local fixture directory",
      );
    if (v["private-capture"]) {
      await mkdir(resolve(v["private-capture"]), {
        recursive: false,
        mode: 0o700,
      });
      process.stderr.write(
        "Private raw capture explicitly enabled. It may contain vendor instructions; delete this directory after local diagnosis. Never publish it.\n",
      );
    }
    const abort = new AbortController();
    const onInterrupt = () => abort.abort();
    process.once("SIGINT", onInterrupt);
    process.once("SIGTERM", onInterrupt);
    try {
      report = await runCases(await discover(dir), v.client, {
        allowUnverified: v["allow-unverified-client"],
        privateDir: v["private-capture"]
          ? resolve(v["private-capture"])
          : undefined,
        signal: abort.signal,
        ...(/^[0-9a-f]{40}$/.test(process.env.SKILLPARCEL_SOURCE_COMMIT ?? "")
          ? { sourceCommit: process.env.SKILLPARCEL_SOURCE_COMMIT }
          : {}),
      });
    } finally {
      process.removeListener("SIGINT", onInterrupt);
      process.removeListener("SIGTERM", onInterrupt);
    }
  }
  await save(
    report,
    v.out ?? (command === "demo" ? "demo-results" : "parcel-results"),
  );
  if (v.format === "junit") process.stdout.write(junit(report));
  else if (v.format === "html") process.stdout.write(await html(report));
  else if (v.json || v.format === "json")
    process.stdout.write(serializeReport(report));
  else
    console.log(
      JSON.stringify({
        toolVersion: report.toolVersion,
        nativeVersion: report.nativeVersion,
        recorded: report.recorded,
        coverage: report.coverage,
        cases: report.cases.map((c) => ({
          id: c.id,
          outcome: c.outcome,
          stages: c.observedStages,
          reasonCode: c.reasonCode,
        })),
        exitCode: report.exitCode,
      }),
    );
  process.exitCode = v.recorded ? 0 : report.exitCode;
}
main().catch((e) => {
  const error =
    e instanceof ParcelError
      ? e
      : new ParcelError("input-or-io", "Invalid input or local I/O failure");
  process.stderr.write(
    JSON.stringify({ error: error.code, message: error.message }) + "\n",
  );
  process.exitCode = /^unsupported/.test(error.code) ? 3 : 2;
});

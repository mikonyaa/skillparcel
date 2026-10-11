import { spawn } from "node:child_process";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  lstat,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import assert from "node:assert/strict";
const { values } = parseArgs({
  options: {
    tarball: { type: "string" },
    client: { type: "string" },
    keep: { type: "boolean" },
    out: { type: "string" },
  },
});
export async function command(cmd, args, cwd, expected = 0) {
  const child = spawn(cmd, args, {
    cwd,
    env: {
      ...process.env,
      npm_config_audit: "false",
      npm_config_fund: "false",
    },
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "",
    stderr = "";
  child.stdout.on("data", (b) => (stdout += b));
  child.stderr.on("data", (b) => (stderr += b));
  const exit = await new Promise((r, j) => {
    child.on("error", j);
    child.on("close", r);
  });
  assert.equal(exit, expected, stderr + "\n" + stdout);
  return stdout;
}
await mkdir("work/pack", { recursive: true });
const tarball = values.tarball
  ? resolve(values.tarball)
  : join(
      process.cwd(),
      "work/pack",
      JSON.parse(
        await command(
          "npm",
          ["pack", "--json", "--pack-destination", "work/pack"],
          process.cwd(),
        ),
      )[0].filename,
    );
const root = await mkdtemp(join(tmpdir(), "skillparcel-consumer-"));
try {
  await writeFile(
    join(root, "package.json"),
    ' {"private":true,"type":"module"}\n',
  );
  await command(
    "npm",
    ["install", "--omit=dev", "--ignore-scripts", tarball],
    root,
  );
  const bin = join(root, "node_modules/skillparcel/dist/cli/main.js");
  assert.equal(
    (await command(process.execPath, [bin, "--version"], root)).trim(),
    "0.1.0",
  );
  await assert.rejects(lstat(join(root, "node_modules/typescript")));
  await assert.rejects(lstat(join(root, "node_modules/skillparcel/src")));
  const example = join(root, "пример with spaces 世界");
  await command(process.execPath, [bin, "init", "--dir", example], root);
  await command(
    process.execPath,
    [bin, "demo", "--recorded", "--out", join(root, "recorded")],
    root,
  );
  const recorded = JSON.parse(
    await readFile(join(root, "recorded/report.json"), "utf8"),
  );
  assert.equal(recorded.recorded, true);
  await command(
    process.execPath,
    [bin, "doctor", "--client", "/nonexistent/claude", "--json"],
    root,
    process.platform === "darwin" && process.arch === "arm64" ? 2 : 3,
  );
  let native = false;
  if (values.client) {
    await command(
      process.execPath,
      [
        bin,
        "run",
        example,
        "--client",
        values.client,
        "--out",
        join(root, "live literal"),
      ],
      root,
    );
    const demo = JSON.parse(
      await command(
        process.execPath,
        [
          bin,
          "demo",
          "--client",
          values.client,
          "--out",
          join(root, "live demo"),
          "--no-open",
        ],
        root,
        1,
      ),
    );
    assert.equal(demo.coverage, "native-verified");
    assert.equal(demo.cases.length, 11);
    assert.equal(demo.cases.filter((c) => c.outcome === "violation").length, 2);
    assert.deepEqual(demo.cases.find((c) => c.id === "reference-read").stages, [
      "body",
      "reference-read",
    ]);
    native = true;
  }
  const result = {
    consumerInstalledOutsideCheckout: true,
    noDevDependencies: true,
    unicodeAndSpacePaths: true,
    init: true,
    recordedView: true,
    nativeConsumer: native,
    nativeResult: native
      ? "9 passes + 2 expected measured violations; forced Read transmitted"
      : "not run; portable checks only",
  };
  if (values.out) {
    await writeFile(
      resolve(values.out),
      JSON.stringify(result, null, 2) + "\n",
    );
  }
  console.log(JSON.stringify(result));
} finally {
  if (values.keep) console.log("Consumer retained:", root);
  else await rm(root, { recursive: true, force: true });
}

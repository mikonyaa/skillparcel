import { spawn } from "node:child_process";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  lstat,
  cp,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, dirname, relative, isAbsolute } from "node:path";
import { parseArgs } from "node:util";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
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
  const packageRoot = join(root, "node_modules/skillparcel");
  const installed = JSON.parse(
    await readFile(join(packageRoot, "package.json"), "utf8"),
  );
  assert.equal(
    (await command(process.execPath, [bin, "--version"], root)).trim(),
    installed.version,
  );
  await assert.rejects(lstat(join(root, "node_modules/typescript")));
  await assert.rejects(lstat(join(root, "node_modules/skillparcel/src")));
  await assert.rejects(lstat(join(root, "node_modules/skillparcel/tests")));
  const visited = new Set(),
    links = new Set();
  async function checkDocument(file) {
    if (visited.has(file)) return;
    visited.add(file);
    const markdown = await readFile(file, "utf8");
    const targets = [
      ...Array.from(
        markdown.matchAll(/!?\[[^\]]*\]\(([^\s)]+)(?:\s+[^)]*)?\)/g),
        (m) => m[1],
      ),
      ...Array.from(
        markdown.matchAll(/^\s*\[[^\]]+\]:\s*(\S+)/gm),
        (m) => m[1],
      ),
    ];
    for (const target of targets) {
      if (/^(?:[a-z][a-z\d+.-]*:|#|\/\/)/i.test(target)) continue;
      const name = decodeURIComponent(
        target.replace(/^<|>$/g, "").split(/[?#]/)[0],
      );
      if (!name) continue;
      const path = resolve(dirname(file), name),
        rel = relative(packageRoot, path);
      assert.ok(
        !rel.startsWith("..") && !isAbsolute(rel),
        "Package link escapes: " + target,
      );
      assert.equal(
        (await lstat(path)).isFile(),
        true,
        "Missing package document target: " + target,
      );
      links.add(relative(packageRoot, path));
      if (path.endsWith(".md")) await checkDocument(path);
    }
  }
  await checkDocument(join(packageRoot, "README.md"));
  assert.ok(links.has("docs/fixture.schema.json"));
  assert.equal(
    (
      await lstat(join(packageRoot, "dist/adapters/claude-code/manifest.js"))
    ).isFile(),
    true,
  );
  assert.ok(links.has("SECURITY.md") && links.has("CONTRIBUTING.md"));
  const example = join(root, "пример with spaces 世界");
  await command(process.execPath, [bin, "init", "--dir", example], root);
  const validated = JSON.parse(
    await command(process.execPath, [bin, "validate", example, "--json"], root),
  );
  assert.equal(validated.valid, true);
  assert.equal(validated.nativeSpawned, false);
  for (const [name, code, edit] of [
    [
      "missing",
      "missing-input",
      (dir) => rm(join(dir, "skill/literal/SKILL.md")),
    ],
    [
      "symlink",
      "symlink",
      async (dir) => {
        const file = join(dir, "skill/literal/SKILL.md");
        await rm(file);
        await symlink("/etc/passwd", file);
      },
    ],
    [
      "utf8",
      "utf8",
      (dir) =>
        writeFile(join(dir, "skill/literal/SKILL.md"), Buffer.from([0xff])),
    ],
    [
      "limit",
      "input-limit",
      (dir) =>
        writeFile(join(dir, "skill/literal/SKILL.md"), "x".repeat(262145)),
    ],
  ]) {
    const dir = join(root, "negative-" + name);
    await cp(example, dir, { recursive: true });
    await edit(dir);
    const invalid = JSON.parse(
      await command(
        process.execPath,
        [bin, "validate", dir, "--json"],
        root,
        2,
      ),
    );
    assert.equal(invalid.valid, false);
    assert.equal(invalid.nativeSpawned, false);
    assert.equal(invalid.reasonCode, code);
  }
  await command(
    process.execPath,
    [bin, "demo", "--recorded", "--out", join(root, "recorded")],
    root,
  );
  const recorded = JSON.parse(
    await readFile(join(root, "recorded/report.json"), "utf8"),
  );
  assert.equal(recorded.recorded, true);
  assert.equal(recorded.exitCode, 1);
  await command(
    process.execPath,
    [
      bin,
      "report",
      join(root, "recorded/report.json"),
      "--out",
      join(root, "rendered.html"),
    ],
    root,
  );
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
    sourceCommit: process.env.SKILLPARCEL_SOURCE_COMMIT ?? null,
    tarballSha256: createHash("sha256")
      .update(await readFile(tarball))
      .digest("hex"),
    consumerInstalledOutsideCheckout: true,
    noDevDependencies: true,
    unicodeAndSpacePaths: true,
    init: true,
    portableValidate: true,
    validationNegativeCases: 4,
    packageVersion: installed.version,
    relativeReadmeTargets: links.size,
    documentTargets: [...links].sort(),
    recordedView: true,
    nativeConsumer: native,
    nativeResult: native
      ? "9 passes + 2 expected measured violations; forced Read transmitted"
      : "not run; portable checks only",
  };
  if (values.out) {
    const evidence = resolve(values.out) + ".reports";
    await mkdir(evidence, { recursive: true });
    await cp(join(root, "recorded"), join(evidence, "recorded"), {
      recursive: true,
      errorOnExist: true,
      force: false,
    });
    if (native) {
      await cp(join(root, "live literal"), join(evidence, "literal"), {
        recursive: true,
        errorOnExist: true,
        force: false,
      });
      await cp(join(root, "live demo"), join(evidence, "demo"), {
        recursive: true,
        errorOnExist: true,
        force: false,
      });
    }
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

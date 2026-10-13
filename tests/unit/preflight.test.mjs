import test from "node:test";
import assert from "node:assert/strict";
import {
  cp,
  mkdtemp,
  rm,
  readFile,
  writeFile,
  symlink,
  lstat,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { preflight } from "../../dist/fixtures/preflight.js";
import { runCases } from "../../dist/run.js";
import { discover } from "../../dist/fixtures/loader.js";

const cli = resolve("dist/cli/main.js");
const invoke = (args) =>
  spawnSync(process.execPath, [cli, ...args], {
    encoding: "utf8",
    timeout: 10000,
  });

test("init + portable validate work in Unicode/space directories without a native prerequisite", async () => {
  const root = await mkdtemp(join(tmpdir(), "sp-authoring-"));
  try {
    const fixture = join(root, "пример with spaces 世界");
    assert.equal(invoke(["init", "--dir", fixture]).status, 0);
    const result = invoke(["validate", fixture, "--json"]);
    assert.equal(result.status, 0, result.stderr);
    const value = JSON.parse(result.stdout);
    assert.equal(value.valid, true);
    assert.equal(value.coverage, "portable-only");
    assert.equal(value.nativeSpawned, false);
    assert.equal(value.caseCount, 1);
    assert.equal(value.cases[0].fixtureHash.length, 64);
    const before = await readFile(join(fixture, "skillparcel.case.json"));
    const missing = invoke(["run", fixture]);
    assert.equal(missing.status, 2);
    assert.equal(JSON.parse(missing.stderr).error, "missing-client");
    assert.deepEqual(
      await readFile(join(fixture, "skillparcel.case.json")),
      before,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("invalid sources, golden, symlink, UTF-8, schema and limits fail before client identity and output", async () => {
  const root = await mkdtemp(join(tmpdir(), "sp-invalid-"));
  const edits = [
    [
      "selector",
      async (dir) => {
        const path = join(dir, "skillparcel.case.json");
        const fixture = JSON.parse(await readFile(path, "utf8"));
        delete fixture.checks[0].sentinels;
        fixture.checks[0].sourceRange = { startByte: 0, endByte: 10 };
        await writeFile(path, JSON.stringify(fixture));
      },
    ],
    [
      "fragment-limit",
      async (dir) => {
        const path = join(dir, "skillparcel.case.json");
        const fixture = JSON.parse(await readFile(path, "utf8"));
        delete fixture.checks[0].expectedText;
        fixture.checks[0].expectedFile = "multibyte-golden.txt";
        await writeFile(path, JSON.stringify(fixture));
        await writeFile(join(dir, "multibyte-golden.txt"), "é".repeat(65537));
      },
    ],
    ["missing-input", (dir) => rm(join(dir, "skill/literal/SKILL.md"))],
    [
      "symlink",
      async (dir) => {
        const file = join(dir, "skill/literal/SKILL.md");
        await rm(file);
        await symlink("/etc/passwd", file);
      },
    ],
    [
      "utf8",
      (dir) =>
        writeFile(join(dir, "skill/literal/SKILL.md"), Buffer.from([0xff])),
    ],
    [
      "input-limit",
      (dir) =>
        writeFile(join(dir, "skill/literal/SKILL.md"), "x".repeat(262145)),
    ],
    [
      "fixture-schema",
      async (dir) => {
        const path = join(dir, "skillparcel.case.json");
        const fixture = JSON.parse(await readFile(path, "utf8"));
        fixture.checks = [];
        await writeFile(path, JSON.stringify(fixture));
      },
    ],
    [
      "missing-input",
      async (dir) => {
        const path = join(dir, "skillparcel.case.json");
        const fixture = JSON.parse(await readFile(path, "utf8"));
        delete fixture.checks[0].expectedText;
        fixture.checks[0].expectedFile = "missing-golden.txt";
        await writeFile(path, JSON.stringify(fixture));
      },
    ],
  ];
  try {
    for (let i = 0; i < edits.length; i++) {
      const [code, edit] = edits[i],
        dir = join(root, "invalid-" + i);
      await cp("fixtures/literal", dir, { recursive: true });
      await edit(dir);
      const validation = invoke(["validate", dir, "--json"]);
      assert.equal(validation.status, 2, validation.stderr);
      const result = JSON.parse(validation.stdout);
      assert.equal(result.valid, false);
      assert.equal(result.nativeSpawned, false);
      assert.equal(result.reasonCode, code);
      await assert.rejects(
        runCases([dir], "/nonexistent/claude"),
        (error) => error.code === code,
      );
      const out = join(root, "bundle-" + i);
      const run = invoke([
        "run",
        dir,
        "--client",
        "/nonexistent/claude",
        "--out",
        out,
      ]);
      assert.equal(run.status, 2);
      assert.equal(JSON.parse(run.stderr).error, code);
      await assert.rejects(lstat(out), { code: "ENOENT" });
    }
    const alias = join(root, "fixture-symlink");
    await symlink(resolve("fixtures/literal"), alias);
    assert.equal(
      JSON.parse(invoke(["validate", alias]).stdout).reasonCode,
      "symlink",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("aggregate input bytes reject a nine-case suite before native prerequisites", async () => {
  const root = await mkdtemp(join(tmpdir(), "sp-suite-input-"));
  try {
    for (let i = 0; i < 9; i++) {
      const dir = join(root, "case-" + i);
      await cp("fixtures/literal", dir, { recursive: true });
      const path = join(dir, "skillparcel.case.json");
      const fixture = JSON.parse(await readFile(path, "utf8"));
      fixture.id = "case-" + i;
      fixture.limits.inputBytes = 1048576;
      await writeFile(path, JSON.stringify(fixture));
      const skill = join(dir, "skill/literal/SKILL.md");
      await writeFile(
        skill,
        (await readFile(skill, "utf8")) + "x".repeat(1040000),
      );
    }
    await assert.rejects(
      runCases(await discover(root), "/nonexistent/claude"),
      (error) => error.code === "suite-limit",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("aggregate reservation rejects a schema-valid suite before any client or output", async () => {
  const root = await mkdtemp(join(tmpdir(), "sp-suite-budget-"));
  try {
    for (let i = 0; i < 16; i++) {
      const dir = join(root, "case-" + i);
      await cp("fixtures/literal", dir, { recursive: true });
      const path = join(dir, "skillparcel.case.json");
      const fixture = JSON.parse(await readFile(path, "utf8"));
      fixture.id = "case-" + i;
      await writeFile(path, JSON.stringify(fixture));
    }
    await assert.rejects(
      preflight(root),
      (error) => error.code === "report-limit",
    );
    const out = join(root, "never-created");
    const result = invoke([
      "run",
      root,
      "--client",
      "/nonexistent/claude",
      "--out",
      out,
    ]);
    assert.equal(result.status, 2);
    assert.equal(JSON.parse(result.stderr).error, "report-limit");
    await assert.rejects(lstat(out), { code: "ENOENT" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

import { mkdtemp, mkdir, writeFile, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { systemEnvironment } from "./identity.js";
import type { Loaded } from "../fixtures/loader.js";
import { ParcelError } from "../fixtures/loader.js";
export async function isolate(loaded: Loaded) {
  const root = await mkdtemp(join(tmpdir(), "skillparcel-"));
  await mkdir(join(root, "project"));
  await mkdir(join(root, "config"));
  await mkdir(join(root, "tmp"));
  const project = join(root, "project"),
    config = join(root, "config"),
    canary = "SP_ISOLATION_" + randomUUID();
  try {
    for (let parent = dirname(root); ; parent = dirname(parent)) {
      for (const name of ["CLAUDE.md", ".claude"]) {
        try {
          await access(join(parent, name));
          throw new ParcelError(
            "ancestor-instructions",
            "Unexpected customization ancestor of temporary run directory",
          );
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
        }
      }
      if (parent === dirname(parent)) break;
    }
    const ownPaths = new Set([
      loaded.fixture.skillDirectory + "/SKILL.md",
      ...(loaded.fixture.referenceRead
        ? [loaded.fixture.referenceRead.path]
        : []),
    ]);
    for (const p of ownPaths) {
      const destination =
        p === loaded.fixture.skillDirectory + "/SKILL.md"
          ? join(
              project,
              ".claude/skills",
              loaded.fixture.invocation.commandName,
              "SKILL.md",
            )
          : join(
              project,
              ".claude/skills",
              loaded.fixture.invocation.commandName,
              p.slice(loaded.fixture.skillDirectory.length + 1),
            );
      if (!p.startsWith(loaded.fixture.skillDirectory + "/"))
        throw new ParcelError(
          "reference-scope",
          "Reference must be inside the selected skill directory",
        );
      await mkdir(dirname(destination), { recursive: true });
      await writeFile(destination, loaded.files.get(p)!, { mode: 0o600 });
    }
    await mkdir(join(config, "skills/skillparcel-canary"), { recursive: true });
    await writeFile(
      join(config, "skills/skillparcel-canary/SKILL.md"),
      "---\nname: skillparcel-canary\ndescription: " +
        canary +
        "\n---\n" +
        canary,
    );
    await writeFile(
      join(config, "settings.json"),
      JSON.stringify({ env: { SKILLPARCEL_CANARY: canary } }),
    );
    await mkdir(join(root, "unselected/skills/sibling"), { recursive: true });
    await writeFile(join(root, "unselected/skills/sibling/SKILL.md"), canary);
    const init = spawnSync(
      "/usr/bin/git",
      ["-c", "core.hooksPath=/dev/null", "init", "--quiet"],
      { cwd: project, env: systemEnvironment(), shell: false },
    );
    if (init.status !== 0)
      throw new ParcelError(
        "git-init",
        "Could not initialize isolated git project",
      );
    return {
      root,
      project,
      config,
      canary,
      sessionId: randomUUID(),
      skillPath: join(
        project,
        ".claude/skills",
        loaded.fixture.invocation.commandName,
      ),
      cleanup: () => rm(root, { recursive: true, force: true }),
    };
  } catch (e) {
    await rm(root, { recursive: true, force: true });
    throw e;
  }
}
export function nativeEnvironment(
  root: string,
  config: string,
  url: string,
  credential: string,
): NodeJS.ProcessEnv {
  return {
    ...systemEnvironment(),
    TMPDIR: join(root, "tmp"),
    SKILLPARCEL_RUN_DIR: root,
    CLAUDE_CONFIG_DIR: config,
    ANTHROPIC_BASE_URL: url,
    ANTHROPIC_API_KEY: credential,
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
    DISABLE_AUTOUPDATER: "1",
    DISABLE_TELEMETRY: "1",
    DISABLE_ERROR_REPORTING: "1",
    API_MAX_RETRIES: "0",
    API_TIMEOUT_MS: "10000",
  };
}
export function nativeArguments(
  project: string,
  skillPath: string,
  loaded: Loaded,
  sessionId: string,
) {
  const f = loaded.fixture;
  const relativeRead = f.referenceRead
    ? ".claude/skills/" +
      f.invocation.commandName +
      "/" +
      f.referenceRead.path.slice(f.skillDirectory.length + 1)
    : "";
  const settings = {
    disableAllHooks: true,
    syncClaudeAiSkills: false,
    syncClaudeAiPlugins: false,
    autoMemoryEnabled: false,
    autoConnectIde: false,
    remoteControlAtStartup: false,
    permissions: {
      allow:
        f.referenceRead?.permission === "allow"
          ? ["Read(./" + relativeRead + ")"]
          : [],
      deny:
        f.referenceRead?.permission === "deny"
          ? ["Read(./" + relativeRead + ")"]
          : [],
      blockReadsOutsideWorkingDirectories: true,
    },
  };
  void skillPath;
  return [
    "--bare",
    "--add-dir",
    project,
    "--setting-sources",
    "project",
    "--settings",
    JSON.stringify(settings),
    "--strict-mcp-config",
    "--mcp-config",
    '{"mcpServers":{}}',
    "--tools",
    f.referenceRead?.request ? "Read" : "",
    "--permission-mode",
    "dontAsk",
    "--permission-prompts",
    "none",
    "--no-session-persistence",
    "--no-chrome",
    "--session-id",
    sessionId,
    "--model",
    "claude-sonnet-4-6",
    "--output-format",
    "stream-json",
    "--verbose",
    "--print",
    "/" +
      f.invocation.commandName +
      (f.invocation.args.length ? " " + f.invocation.args.join(" ") : ""),
  ];
}

import {
  readFile,
  realpath,
  lstat,
  access,
  mkdtemp,
  rm,
} from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { manifest } from "../adapters/claude-code/manifest.js";
import { hash, ParcelError } from "../fixtures/loader.js";
const exec = promisify(execFile);
export const systemEnvironment = (): NodeJS.ProcessEnv => ({
  PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
  ...(process.env.HOME ? { HOME: process.env.HOME } : {}),
  LANG: "en_US.UTF-8",
});
export interface Identity {
  version: string;
  sha256: string;
  platform: string;
  architecture: string;
  verified: boolean;
  signature: string;
  installation: string;
}
export async function policyAbsent() {
  for (const path of [
    "/Library/Application Support/ClaudeCode",
    "/Library/Managed Preferences/com.anthropic.claudecode.plist",
  ]) {
    try {
      await access(path);
      throw new ParcelError(
        "managed-policy",
        "Managed policy is outside this adapter isolation scope; native gate stopped",
      );
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
  }
  const pref = await exec(
    "/usr/bin/defaults",
    ["read", "com.anthropic.claudecode"],
    { env: systemEnvironment(), timeout: 5000, maxBuffer: 131072 },
  ).then(
    (r) => r.stdout,
    (error: unknown) => {
      if (
        String((error as { stderr?: string }).stderr).includes(
          "Domain com.anthropic.claudecode does not exist",
        )
      )
        return null;
      throw new ParcelError(
        "managed-policy-query",
        "Could not establish absence of macOS policy; native gate stopped",
      );
    },
  );
  if (pref !== null)
    throw new ParcelError(
      "managed-policy",
      "macOS policy domain is present; native gate stopped",
    );
}
export async function identify(
  client: string,
  allowUnverified = false,
): Promise<{ executable: string; identity: Identity }> {
  if (Number(process.versions.node.split(".")[0]) !== 24)
    throw new ParcelError(
      "unsupported-runtime",
      "Native verification requires Node 24 LTS",
    );
  if (!isAbsolute(client))
    throw new ParcelError(
      "client-path",
      "--client must be an absolute native executable path",
    );
  if (process.platform !== "darwin" || process.arch !== "arm64")
    throw new ParcelError(
      "unsupported-platform",
      "Native coverage is limited to macOS arm64",
    );
  let executable: string;
  try {
    executable = await realpath(client);
  } catch {
    throw new ParcelError(
      "missing-client",
      "Install Claude Code using its official native installer, then pass its absolute path with --client",
    );
  }
  const stat = await lstat(executable);
  if (!stat.isFile() || stat.size > 400 * 1024 * 1024)
    throw new ParcelError("native-identity", "Not a regular native binary");
  const bytes = await readFile(executable);
  if (
    bytes.readUInt32LE(0) !== 0xfeedfacf ||
    bytes.readUInt32LE(4) !== 0x100000c
  )
    throw new ParcelError(
      "native-identity",
      "Expected a Mach-O arm64 binary; wrappers and unit mocks are rejected",
    );
  await exec("/usr/bin/codesign", ["--verify", "--strict", executable], {
    env: systemEnvironment(),
    timeout: 10000,
    maxBuffer: 131072,
  }).catch(() => {
    throw new ParcelError(
      "native-identity",
      "Native code signature verification failed",
    );
  });
  const signing = await exec(
    "/usr/bin/codesign",
    ["-dv", "--verbose=2", executable],
    { env: systemEnvironment(), timeout: 5000, maxBuffer: 131072 },
  );
  if (
    !signing.stderr.includes("TeamIdentifier=" + manifest.teamIdentifier) ||
    !signing.stderr.includes("Identifier=com.anthropic.claude-code")
  )
    throw new ParcelError(
      "native-identity",
      "Expected Anthropic vendor identity",
    );
  await policyAbsent();
  const preflight = await mkdtemp(join(tmpdir(), "skillparcel-identity-"));
  const preflightEnv = {
    ...systemEnvironment(),
    CLAUDE_CONFIG_DIR: preflight,
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
    DISABLE_AUTOUPDATER: "1",
    DISABLE_TELEMETRY: "1",
    DISABLE_ERROR_REPORTING: "1",
  };
  try {
    const version = (
      await exec(executable, ["--bare", "--version"], {
        env: preflightEnv,
        timeout: 5000,
        maxBuffer: 65536,
      })
    ).stdout
      .trim()
      .match(/^(\d+\.\d+\.\d+) \(Claude Code\)$/)?.[1];
    if (!version)
      throw new ParcelError(
        "native-identity",
        "Unrecognized native version response",
      );
    const sha256 = hash(bytes),
      verified =
        version === manifest.testedExecutableVersions[0] &&
        sha256 === manifest.executableSha256;
    if (!verified && !allowUnverified)
      throw new ParcelError(
        "unsupported-version",
        "Untested native build. Diagnostic use requires --allow-unverified-client and never grants verified coverage",
      );
    const help = (
      await exec(executable, ["--bare", "--help"], {
        env: preflightEnv,
        timeout: 5000,
        maxBuffer: 131072,
      })
    ).stdout;
    for (const flag of manifest.requiredFlags) {
      if (!help.includes(flag))
        throw new ParcelError(
          "unsupported-flags",
          "Required native flag is unavailable: " + flag,
        );
    }
    return {
      executable,
      identity: {
        version,
        sha256,
        platform: process.platform,
        architecture: process.arch,
        verified,
        signature: manifest.teamIdentifier,
        installation:
          "Anthropic signed native distribution (separately installed)",
      },
    };
  } finally {
    await rm(preflight, { recursive: true, force: true });
  }
}

import { readdir, realpath, lstat, open } from "node:fs/promises";
import { resolve, relative, join, basename } from "node:path";
import { constants } from "node:fs";
import { createHash } from "node:crypto";
import { fixtureSchema, relativePath } from "./schema.js";
import type { Fixture, Check } from "./schema.js";
import { ParcelError } from "../errors.js";
import { budgets, assertBudget } from "../budgets.js";
export { ParcelError } from "../errors.js";
export const hash = (bytes: Uint8Array | string) =>
  createHash("sha256").update(bytes).digest("hex");
export function decode(bytes: Uint8Array) {
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
      bytes,
    );
  } catch {
    throw new ParcelError("utf8", "Input must be well-formed UTF-8");
  }
}
export async function boundedFile(path: string, limit: number) {
  const handle = await open(
    path,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > limit)
      throw new ParcelError("input-limit", "Expected a bounded regular file");
    const chunks: Buffer[] = [];
    let total = 0;
    while (true) {
      const chunk = Buffer.alloc(65536);
      const { bytesRead } = await handle.read(chunk, 0, chunk.length, null);
      if (!bytesRead) break;
      total += bytesRead;
      if (total > limit)
        throw new ParcelError(
          "input-limit",
          "Input grew beyond its byte limit",
        );
      chunks.push(chunk.subarray(0, bytesRead));
    }
    return Buffer.concat(chunks);
  } finally {
    await handle.close();
  }
}

export async function contained(
  root: string,
  p: string,
  missing = false,
): Promise<string> {
  relativePath.parse(p);
  let current = root;
  for (const segment of p.split("/")) {
    const names = await readdir(current);
    const match = names.filter(
      (n) =>
        n.normalize("NFC").toLowerCase() ===
        segment.normalize("NFC").toLowerCase(),
    );
    if (match.length > 1 || (match.length === 1 && match[0] !== segment))
      throw new ParcelError("ambiguous-path", "Path spelling is ambiguous");
    current = join(current, segment);
    try {
      const s = await lstat(current);
      if (s.isSymbolicLink())
        throw new ParcelError("symlink", "Symlinks are not accepted in v1");
    } catch (e) {
      if (missing && (e as NodeJS.ErrnoException).code === "ENOENT") {
        const rest = p.slice(relative(root, current).length);
        current += rest;
        break;
      }
      throw e;
    }
  }
  if (!missing) current = await realpath(current);
  const rel = relative(root, current);
  if (rel.startsWith("..") || rel.startsWith("/"))
    throw new ParcelError("path-escape", "Path leaves case root");
  return current;
}
export function select(
  text: string,
  c: Pick<Check, "sentinels" | "sourceRange">,
): string {
  if (c.sentinels) {
    const { begin, end } = c.sentinels;
    const at = text.indexOf(begin),
      last = text.indexOf(end, at + begin.length);
    if (
      at < 0 ||
      last < 0 ||
      text.indexOf(end) !== last ||
      text.indexOf(begin, at + begin.length) >= 0 ||
      text.indexOf(end, last + end.length) >= 0
    )
      throw new ParcelError(
        "selector",
        "Sentinels must occur exactly once in order",
      );
    return text.slice(at + begin.length, last);
  }
  const bytes = Buffer.from(text, "utf8");
  const range = c.sourceRange!;
  if (range.startByte >= range.endByte || range.endByte > bytes.length)
    throw new ParcelError("selector", "Byte range exceeds source");
  return decode(bytes.subarray(range.startByte, range.endByte));
}
function validateSkill(text: string, name: string) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(text);
  if (!match)
    throw new ParcelError(
      "frontmatter",
      "A small scalar frontmatter block is required",
    );
  const fields = new Map<string, string>();
  for (const line of match[1]!.split(/\r?\n/)) {
    const m =
      /^(name|description|disable-model-invocation|argument-hint): ([^\n]+)$/.exec(
        line,
      );
    if (!m || fields.has(m[1]!))
      throw new ParcelError(
        "frontmatter",
        "Unsupported or duplicate frontmatter field",
      );
    fields.set(m[1]!, m[2]!);
  }
  if (
    fields.get("name") !== name ||
    !fields.get("description") ||
    fields.get("disable-model-invocation") !== "true"
  )
    throw new ParcelError(
      "frontmatter",
      "Name must match and disable-model-invocation must be true",
    );
  if (
    /!\s*`/.test(text) ||
    /\$\{CLAUDE_SKILL_DIR\}.*(?:scripts|hooks)/i.test(text)
  )
    throw new ParcelError(
      "dynamic-execution",
      "Dynamic shell injection is unsupported",
    );
}
export interface Loaded {
  root: string;
  fixture: Fixture;
  files: Map<string, Buffer>;
  fixtureHash: string;
  checks: {
    check: Check;
    source: string;
    expected: string;
    sourceHash: string;
    range: { startByte: number; endByte: number };
  }[];
}
export async function loadFixture(dir: string): Promise<Loaded> {
  if ((await lstat(resolve(dir))).isSymbolicLink())
    throw new ParcelError("symlink", "Fixture roots must not be symlinks");
  const root = await realpath(resolve(dir));
  const caseBytes = await boundedFile(
    await contained(root, "skillparcel.case.json"),
    budgets.fixtureJsonBytes,
  );
  let fixture: Fixture;
  try {
    fixture = fixtureSchema.parse(JSON.parse(decode(caseBytes)));
  } catch (error) {
    if (error instanceof ParcelError) throw error;
    throw new ParcelError(
      "fixture-schema",
      "Invalid case JSON or authoring schema; see docs/fixture.schema.json",
    );
  }
  const files = new Map<string, Buffer>([["skillparcel.case.json", caseBytes]]);
  const paths = new Set([
    fixture.skillDirectory + "/SKILL.md",
    ...fixture.checks.flatMap((c) => [
      c.sourceFile,
      ...(c.expectedFile ? [c.expectedFile] : []),
    ]),
  ]);
  if (fixture.referenceRead) {
    if (!fixture.referenceRead.path.startsWith(fixture.skillDirectory + "/"))
      throw new ParcelError(
        "reference-path",
        "Declared reference must be inside the skill directory",
      );
    try {
      await contained(root, fixture.referenceRead.path);
      paths.add(fixture.referenceRead.path);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT")
        throw new ParcelError(
          "missing-reference",
          "Declared reference file is missing",
        );
      throw e;
    }
  }
  let total = caseBytes.length;
  assertBudget(
    total,
    fixture.limits.inputBytes,
    "input-limit",
    "Fixture input",
  );
  for (const p of [...paths].sort()) {
    let file: string;
    try {
      file = await contained(root, p);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        throw new ParcelError(
          "missing-input",
          "A declared source or golden file is missing",
        );
      throw error;
    }
    const s = await lstat(file);
    if (!s.isFile() || s.size > fixture.limits.inputBytes)
      throw new ParcelError("input-limit", "Input is not a small regular file");
    const bytes = await boundedFile(file, fixture.limits.inputBytes);
    total += bytes.length;
    if (total > fixture.limits.inputBytes)
      throw new ParcelError("input-limit", "Fixture exceeds input byte limit");
    decode(bytes);
    files.set(p, bytes);
  }
  if (basename(fixture.skillDirectory) !== fixture.invocation.commandName)
    throw new ParcelError(
      "skill-name",
      "Directory name must match explicit command",
    );
  validateSkill(
    decode(files.get(fixture.skillDirectory + "/SKILL.md")!),
    fixture.invocation.commandName,
  );
  // Only declared text inputs are copied; scripts/hooks/settings are never copied.
  const checks = fixture.checks.map((check) => {
    if (
      (check.stage === "body" &&
        check.sourceFile !== fixture.skillDirectory + "/SKILL.md") ||
      (check.stage === "reference-read" &&
        check.sourceFile !== fixture.referenceRead?.path)
    )
      throw new ParcelError(
        "stage-source",
        "Check source must match its native stage",
      );
    const bytes = files.get(check.sourceFile)!;
    if (check.stage === "body" && check.sourceRange) {
      const header = /^---\r?\n[\s\S]*?\r?\n---\r?\n/.exec(decode(bytes))![0];
      if (check.sourceRange.startByte < Buffer.byteLength(header))
        throw new ParcelError(
          "selector",
          "Body byte selector overlaps frontmatter",
        );
    }
    const text = decode(bytes),
      source = select(text, check),
      expected = check.expectedText ?? decode(files.get(check.expectedFile!)!);
    if (
      Buffer.byteLength(source) > budgets.sourceFragmentBytes ||
      Buffer.byteLength(expected) > budgets.sourceFragmentBytes
    )
      throw new ParcelError(
        "fragment-limit",
        "Selected source and golden must each be at most 128 KiB",
      );
    const startByte =
      check.sourceRange?.startByte ??
      Buffer.byteLength(
        text.slice(
          0,
          text.indexOf(check.sentinels!.begin) + check.sentinels!.begin.length,
        ),
      );
    return {
      check,
      source,
      expected,
      sourceHash: hash(bytes),
      range: { startByte, endByte: startByte + Buffer.byteLength(source) },
    };
  });
  const fixtureHash = hash(
    [...files]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([p, b]) => p + "\0" + hash(b))
      .join("\n"),
  );
  return { root, fixture, files, fixtureHash, checks };
}
export async function assertNoDrift(loaded: Loaded) {
  for (const [p, bytes] of loaded.files) {
    const path = await contained(loaded.root, p);
    if (
      hash(await boundedFile(path, loaded.fixture.limits.inputBytes)) !==
      hash(bytes)
    )
      throw new ParcelError(
        "source-drift",
        "Fixture changed after its hash was computed",
      );
  }
}
export async function discover(dir: string): Promise<string[]> {
  if ((await lstat(resolve(dir))).isSymbolicLink())
    throw new ParcelError("symlink", "Fixture roots must not be symlinks");
  const root = await realpath(resolve(dir));
  try {
    await lstat(join(root, "skillparcel.case.json"));
    return [root];
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
  const found: string[] = [];
  for (const e of await readdir(root, { withFileTypes: true })) {
    if (e.isSymbolicLink())
      throw new ParcelError(
        "symlink",
        "Fixture directories must not be symlinks",
      );
    if (e.isDirectory()) {
      try {
        await lstat(join(root, e.name, "skillparcel.case.json"));
        found.push(join(root, e.name));
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      }
    }
  }
  if (!found.length || found.length > budgets.cases)
    throw new ParcelError(
      "case-count",
      "Expected between 1 and 50 intentional local cases",
    );
  return found.sort();
}

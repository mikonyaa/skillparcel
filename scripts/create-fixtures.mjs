import { mkdir, writeFile, cp } from "node:fs/promises";
import { join } from "node:path";
const createdAt = new Date().toISOString();
const cases = [
  {
    id: "literal",
    title: "A literal through the native loader",
    text: "SkillParcel original synthetic literal: orchard-73.\nFormula =B5*(1+$B$6)",
    args: [],
  },
  {
    id: "dollar-digit",
    title: "Dollar digits with seven explicit arguments",
    text: "Formula =B5*(1+$B$6)\nSecond: $1\nSeventh: $6",
    args: ["one", "two", "three", "four", "five", "six", "seven"],
    expected: "Formula =B5*(1+$B$6)\nSecond: $1\nSeventh: $6",
    outcome: "violation",
    basis:
      "Author requires literal dollars, as in a formula or shell snippet. An indexed substitution is a measured literal-contract violation, not a semantic evaluation.",
  },
  {
    id: "argument-substitution",
    title: "Intentional indexed and full argument substitution",
    text: "All: $ARGUMENTS\nFirst: $0\nSecond: $ARGUMENTS[1]",
    args: ["north", "south"],
    expected: "All: north south\nFirst: north\nSecond: south",
    basis: "Author explicitly requests documented argument substitution.",
  },
  {
    id: "escaped-dollar",
    title: "Escaped literal formula and awk placeholder",
    text: "Formula =B5*(1+$B\\$6)\nawk '{print \\$1}'\nLiteral \\$6",
    args: ["one", "two", "three", "four", "five", "six", "seven"],
    expected: "Formula =B5*(1+$B$6)\nawk '{print $1}'\nLiteral $6",
    basis:
      "Author expects the documented backslash escape to render a literal dollar-digit.",
  },
  {
    id: "unicode-empty",
    title: "UTF-8, combining character and an empty fragment",
    text: "Привет · 世界 · 👋 · e\u0301\n\n<!-- EMPTY_BEGIN --><!-- EMPTY_END -->",
    args: [],
    empty: true,
  },
  {
    id: "lf",
    title: "LF bytes with exact comparison",
    text: "First line\nSecond line",
    args: [],
  },
  {
    id: "crlf",
    title: "CRLF with declared CRLF → LF normalization",
    text: "First line\r\nSecond line",
    args: [],
    eol: "\r\n",
    normalization: "crlf-to-lf",
  },
  {
    id: "reference-read",
    title: "Body followed by a forced native Read",
    text: "Body is measured before Read.\nReference: references/proof.txt",
    args: [],
    read: true,
  },
  {
    id: "reference-withheld",
    title: "Reference exists but is not transmitted without Read",
    text: "Only this body is requested.\nReference: references/proof.txt",
    args: [],
    withheld: true,
  },
  {
    id: "intentional-mismatch",
    title: "An author contract catches our changed source",
    text: "Author-owned revision B",
    expected: "Author-owned revision A",
    args: [],
    outcome: "violation",
    basis:
      "Controlled source mutation B; golden A is intentionally unchanged. This is our fixture-contract failure and is not claimed as a vendor bug.",
  },
  {
    id: "repeated-html",
    title: "Repeated marker, long line and hostile HTML as text",
    text:
      "repeat-me repeat-me\n</script><script>globalThis.SKILLPARCEL_ATTACK=true</script>\n" +
      "Long synthetic text · ".repeat(80),
    args: [],
    contains: true,
  },
];
for (const spec of cases) {
  const dir = join("fixtures", spec.id),
    skill = "skill/" + spec.id,
    eol = spec.eol ?? "\n";
  await mkdir(join(dir, skill), { recursive: true });
  const begin = "<!-- SP_" + spec.id + "_BEGIN -->",
    end = "<!-- SP_" + spec.id + "_END -->";
  const fragment = eol + spec.text + eol;
  const expected = eol + (spec.expected ?? spec.text) + eol;
  await writeFile(
    join(dir, skill, "SKILL.md"),
    [
      "---",
      "name: " + spec.id,
      "description: Original synthetic SkillParcel fixture",
      "disable-model-invocation: true",
      ...(spec.id === "argument-substitution"
        ? ["argument-hint: first second"]
        : []),
      "---",
      begin + fragment + end,
      "",
    ].join(eol),
  );
  const checks = [
    {
      id: "body-text",
      stage: "body",
      sourceFile: skill + "/SKILL.md",
      sentinels: { begin, end },
      expectedText: expected,
      mode: "exact-text",
      expectedOccurrences: 1,
      normalization: spec.normalization ?? "none",
    },
  ];
  if (spec.empty)
    checks.push({
      id: "empty-fragment",
      stage: "body",
      sourceFile: skill + "/SKILL.md",
      sentinels: { begin: "<!-- EMPTY_BEGIN -->", end: "<!-- EMPTY_END -->" },
      expectedText: "",
      mode: "exact-text",
      expectedOccurrences: 1,
      normalization: "none",
    });
  if (spec.contains)
    checks.push({
      id: "two-occurrences-only-in-first-request",
      stage: "body",
      sourceFile: skill + "/SKILL.md",
      sentinels: { begin, end },
      expectedText: "repeat-me",
      mode: "contains-exact",
      expectedOccurrences: 2,
      normalization: "none",
    });
  if (spec.read || spec.withheld) {
    await mkdir(join(dir, skill, "references"), { recursive: true });
    const reference =
      "<!-- SP_REF_BEGIN -->\nOriginal reference only: cedar-41.\nПрочитано 世界 👋 e\u0301\n<!-- SP_REF_END -->\n";
    await writeFile(join(dir, skill, "references/proof.txt"), reference);
    if (spec.read)
      checks.push({
        id: "forced-read-text",
        stage: "reference-read",
        sourceFile: skill + "/references/proof.txt",
        sentinels: {
          begin: "<!-- SP_REF_BEGIN -->",
          end: "<!-- SP_REF_END -->",
        },
        expectedText:
          "\nOriginal reference only: cedar-41.\nПрочитано 世界 👋 e\u0301\n",
        mode: "exact-text",
        expectedOccurrences: 1,
        normalization: "none",
      });
  }
  const fixture = {
    schemaVersion: 1,
    id: spec.id,
    title: spec.title,
    description:
      "Original synthetic, intentionally prepared local fixture. No downloaded skill code executes.",
    tags: [
      "synthetic",
      ...(spec.outcome === "violation" ? ["negative-control"] : []),
    ],
    client: { adapter: "claude-code", supportedVersion: "2.1.280" },
    skillDirectory: skill,
    invocation: {
      kind: "explicit-command",
      commandName: spec.id,
      args: spec.args,
    },
    expectedStages: {
      body: "required",
      "reference-read": spec.read ? "required" : "optional",
    },
    checks,
    ...(spec.read || spec.withheld
      ? {
          referenceRead: {
            path: skill + "/references/proof.txt",
            request: Boolean(spec.read),
            permission: "allow",
          },
        }
      : {}),
    limits: {
      inputBytes: 262144,
      requestBytes: 8388608,
      turns: 8,
      timeoutMs: 30000,
    },
    golden: {
      author: "mikonyaa / SkillParcel synthetic corpus",
      basis:
        spec.basis ??
        "Author requires exact source text between its explicit sentinels, before any native run.",
      createdAt,
    },
  };
  await writeFile(
    join(dir, "skillparcel.case.json"),
    JSON.stringify(fixture, null, 2) + "\n",
  );
}
await mkdir("templates", { recursive: true });
await cp("fixtures/literal", "templates/parcel-example", { recursive: true });
await mkdir("tests/native", { recursive: true });
await writeFile(
  "tests/native/expected-outcomes.json",
  JSON.stringify(
    Object.fromEntries(cases.map((c) => [c.id, c.outcome ?? "pass"])),
    null,
    2,
  ) + "\n",
);
console.log(
  "11 author contracts created before capture; two intentional expected violations.",
);

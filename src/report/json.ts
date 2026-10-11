import { z } from "zod";
const fragment = z.string().max(262144);
const event = z.strictObject({
  sequence: z.number(),
  stage: z.string(),
  elapsedMs: z.number(),
  requestOrdinal: z.number().optional(),
  toolUseId: z.string().optional(),
  detail: z.string().optional(),
});
const check = z.strictObject({
  id: z.string(),
  stage: z.string(),
  sourceFile: z.string(),
  sourceSha256: z.string(),
  encoding: z.literal("UTF-8"),
  sourceRange: z.strictObject({ startByte: z.number(), endByte: z.number() }),
  source: fragment,
  expected: fragment,
  transmitted: fragment.nullable(),
  mode: z.string(),
  normalization: z.string(),
  expectedOccurrences: z.number(),
  pass: z.boolean().nullable(),
  rawPass: z.boolean().nullable(),
  occurrences: z.number().nullable(),
  diff: z
    .array(z.strictObject({ kind: z.string(), text: fragment }))
    .max(10000),
  evidenceRef: z
    .strictObject({
      requestOrdinal: z.number(),
      messageIndex: z.number(),
      blockIndex: z.number(),
      toolUseId: z.string().optional(),
    })
    .optional(),
});
export const caseReportSchema = z
  .strictObject({
    id: z.string().max(200),
    title: z.string().max(200),
    fixtureHash: z.string(),
    outcome: z.enum(["pass", "violation", "error", "unsupported", "cancelled"]),
    measurementStatus: z.enum([
      "complete",
      "error",
      "unsupported",
      "cancelled",
    ]),
    contractStatus: z.enum(["pass", "violation", "not-measured"]),
    reason: z.string().max(2000).optional(),
    reasonCode: z.string().max(200).optional(),
    observedStages: z.array(z.string()).max(20),
    checks: z.array(check).max(30),
    limits: z.strictObject({
      inputBytes: z.number(),
      requestBytes: z.number(),
      turns: z.number(),
      timeoutMs: z.number(),
    }),
    evidence: z.array(event).max(100),
    evidenceRefs: z
      .array(z.strictObject({ requestOrdinal: z.number(), bytes: z.number() }))
      .max(8),
    isolation: z
      .strictObject({
        uniqueConfig: z.boolean(),
        newSession: z.boolean(),
        homePreserved: z.boolean(),
        excludedCanaryAbsent: z.boolean(),
        onlyExpectedTools: z.boolean(),
        cleanup: z.boolean(),
      })
      .optional(),
    nativeExitCode: z.number().optional(),
    omissions: z.array(z.string()).max(20),
  })
  .superRefine((c, ctx) => {
    if (c.outcome === "pass" || c.outcome === "violation") {
      if (
        c.measurementStatus !== "complete" ||
        !c.observedStages.includes("body") ||
        !c.checks.length ||
        c.checks.some((x) => x.pass === null || x.transmitted === null)
      )
        ctx.addIssue({
          code: "custom",
          message: "A verdict requires completed nonzero measurements",
        });
      const contract = c.checks.every((x) => x.pass === true)
        ? "pass"
        : "violation";
      if (c.contractStatus !== contract || c.outcome !== contract)
        ctx.addIssue({
          code: "custom",
          message: "Contract status disagrees with measured checks",
        });
    }
  });
export const reportSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    toolVersion: z.string(),
    adapterVersion: z.string(),
    nativeVersion: z.string(),
    nativeSha256: z.string(),
    OS: z.string(),
    arch: z.string(),
    recordedAt: z.string(),
    sourceCommit: z.string().optional(),
    invocationMode: z.string(),
    networkMode: z.string(),
    coverage: z.enum([
      "native-verified",
      "diagnostic-unverified",
      "portable-only",
    ]),
    recorded: z.boolean(),
    cases: z.array(caseReportSchema).max(50),
    exitCode: z.number(),
    omissions: z.array(z.string()).max(20),
  })
  .superRefine((r, ctx) => {
    const codes = r.cases.map(
      (c) =>
        ({ pass: 0, violation: 1, error: 2, unsupported: 3, cancelled: 130 })[
          c.outcome
        ],
    );
    const expected = codes.includes(130)
      ? 130
      : ([2, 3, 1, 0].find((c) => codes.includes(c)) ?? 3);
    if (r.exitCode !== expected)
      ctx.addIssue({
        code: "custom",
        message:
          "Report exit code must match measured outcomes; zero cases cannot pass",
      });
    if (
      r.coverage === "native-verified" &&
      (r.OS !== "darwin" ||
        r.arch !== "arm64" ||
        r.nativeVersion !== "2.1.280" ||
        r.nativeSha256 !==
          "387a5c5dcdbb815085edf0baf79591f9d8894efe922bceaf3d75b1b08055229d")
    )
      ctx.addIssue({
        code: "custom",
        message: "Verified metadata must match the tested native identity",
      });
  });
export type CaseReport = z.infer<typeof caseReportSchema>;
export type Report = z.infer<typeof reportSchema>;
export function publicReport(x: unknown): Report {
  return reportSchema.parse(x);
}
export const serializeReport = (x: Report) =>
  JSON.stringify(publicReport(x), null, 2) + "\n";

import { z } from "zod";
const id = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/);
export const relativePath = z
  .string()
  .min(1)
  .max(240)
  .refine(
    (p) =>
      !p.startsWith("/") &&
      !p.includes("\\") &&
      !p.includes("\0") &&
      p.split("/").every((c) => c !== "" && c !== "." && c !== "..") &&
      !/^[a-z]:/i.test(p),
    "Use a contained relative path",
  );
const selector = {
  sourceRange: z
    .strictObject({
      startByte: z.number().int().nonnegative(),
      endByte: z.number().int().positive(),
    })
    .optional(),
  sentinels: z
    .strictObject({
      begin: z.string().min(1).max(200),
      end: z.string().min(1).max(200),
    })
    .optional(),
};
export const checkSchema = z
  .strictObject({
    id,
    stage: z.enum(["body", "reference-read"]),
    sourceFile: relativePath,
    ...selector,
    expectedText: z.string().max(131072).optional(),
    expectedFile: relativePath.optional(),
    mode: z.enum(["exact-text", "contains-exact"]),
    expectedOccurrences: z.number().int().min(1).max(100),
    normalization: z.enum(["none", "crlf-to-lf"]).default("none"),
  })
  .refine(
    (x) => (x.sourceRange !== undefined) !== (x.sentinels !== undefined),
    "Choose one source selector",
  )
  .refine(
    (x) => (x.expectedText !== undefined) !== (x.expectedFile !== undefined),
    "Choose one author golden",
  );
export const fixtureSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    id,
    title: z.string().min(1).max(200),
    description: z.string().max(2000),
    tags: z.array(id).max(20),
    client: z.strictObject({
      adapter: z.literal("claude-code"),
      supportedVersion: z.literal("2.1.280"),
    }),
    skillDirectory: relativePath,
    invocation: z.strictObject({
      kind: z.literal("explicit-command"),
      commandName: id,
      args: z
        .array(
          z
            .string()
            .max(1000)
            .refine((s) => !/[\r\n\0]/.test(s)),
        )
        .max(20),
    }),
    expectedStages: z.strictObject({
      body: z.literal("required"),
      "reference-read": z.enum(["required", "optional"]),
    }),
    checks: z.array(checkSchema).min(1).max(30),
    referenceRead: z
      .strictObject({
        path: relativePath,
        request: z.boolean().default(true),
        permission: z.enum(["allow", "deny"]).default("allow"),
      })
      .optional(),
    limits: z
      .strictObject({
        inputBytes: z.number().int().min(1).max(1048576).default(262144),
        requestBytes: z.number().int().min(1024).max(8388608).default(8388608),
        turns: z.number().int().min(1).max(8).default(8),
        timeoutMs: z.number().int().min(500).max(90000).default(30000),
      })
      .default({
        inputBytes: 262144,
        requestBytes: 8388608,
        turns: 8,
        timeoutMs: 30000,
      }),
    golden: z.strictObject({
      author: z.string().min(1).max(120),
      basis: z.string().min(1).max(1000),
      createdAt: z.string().datetime(),
    }),
  })
  .superRefine((f, ctx) => {
    if (new Set(f.checks.map((x) => x.id)).size !== f.checks.length)
      ctx.addIssue({ code: "custom", message: "Duplicate check IDs" });
    if (!f.checks.some((c) => c.stage === "body"))
      ctx.addIssue({
        code: "custom",
        message: "At least one body check is required",
      });
    if (
      f.referenceRead?.request === false &&
      (f.expectedStages["reference-read"] === "required" ||
        f.checks.some((c) => c.stage === "reference-read"))
    )
      ctx.addIssue({
        code: "custom",
        message: "Withheld Read cannot have required reference checks",
      });
    if (
      (f.expectedStages["reference-read"] === "required" ||
        f.checks.some((c) => c.stage === "reference-read")) &&
      !f.referenceRead
    )
      ctx.addIssue({
        code: "custom",
        message: "Reference checks require referenceRead",
      });
  });
export type Fixture = z.infer<typeof fixtureSchema>;
export type Check = z.infer<typeof checkSchema>;

import { join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  loadFixture,
  assertNoDrift,
  ParcelError,
  select,
  decode,
} from "./fixtures/loader.js";
import {
  isolate,
  nativeArguments,
  nativeEnvironment,
} from "./native/isolation.js";
import { runProcess } from "./native/process.js";
import { identify } from "./native/identity.js";
import { manifest } from "./adapters/claude-code/manifest.js";
import { startEndpoint } from "./provider/loopback.js";
import {
  bodyBlock,
  resultText,
  readFragment,
  toolResult,
} from "./capture/extract.js";
import { compare } from "./contracts/compare.js";
import { Events } from "./capture/events.js";
import type { Report, CaseReport } from "./report/json.js";
export const TOOL_VERSION = "0.1.0";
export function exitPriority(codes: number[]) {
  if (codes.includes(130)) return 130;
  return [2, 3, 1, 0].find((c) => codes.includes(c)) ?? 3;
}
const caseExit = (c: CaseReport) =>
  ({ pass: 0, violation: 1, error: 2, unsupported: 3, cancelled: 130 })[
    c.outcome
  ];
export async function runCases(
  dirs: string[],
  client: string,
  options: {
    allowUnverified?: boolean;
    privateDir?: string;
    signal?: AbortSignal;
    sourceCommit?: string;
  } = {},
): Promise<Report> {
  const { executable, identity } = await identify(
    client,
    options.allowUnverified,
  );
  const report: Report = {
    schemaVersion: 1,
    toolVersion: TOOL_VERSION,
    adapterVersion: manifest.adapterVersion,
    nativeVersion: identity.version,
    nativeSha256: identity.sha256,
    OS: identity.platform,
    arch: identity.architecture,
    recordedAt: new Date().toISOString(),
    ...(options.sourceCommit ? { sourceCommit: options.sourceCommit } : {}),
    invocationMode: manifest.invocationModes[0],
    networkMode:
      "127.0.0.1 synthetic Messages endpoint; no OS egress confinement",
    coverage: identity.verified ? "native-verified" : "diagnostic-unverified",
    recorded: false,
    cases: [],
    exitCode: 3,
    omissions: [
      "Model response quality and voluntary reference selection are not measured",
      "No other client, default interactive mode, OS or native build is certified",
      "Raw HTTP, vendor instructions, headers, CLI stdout and user profiles are omitted",
    ],
  };
  for (const dir of dirs) {
    const ev = new Events();
    const c: CaseReport = {
      id: "invalid-fixture",
      title: "Fixture validation",
      fixtureHash: "",
      outcome: "error",
      measurementStatus: "error",
      contractStatus: "not-measured",
      observedStages: [],
      checks: [],
      limits: { inputBytes: 0, requestBytes: 0, turns: 0, timeoutMs: 0 },
      evidence: ev.events,
      evidenceRefs: [],
      omissions: [],
    };
    let isolation: Awaited<ReturnType<typeof isolate>> | undefined,
      endpoint: Awaited<ReturnType<typeof startEndpoint>> | undefined;
    const abort = new AbortController();
    const forward = () => abort.abort();
    options.signal?.addEventListener("abort", forward, { once: true });
    if (options.signal?.aborted) abort.abort();
    try {
      ev.add("validate");
      const loaded = await loadFixture(dir);
      const f = loaded.fixture;
      c.id = f.id;
      c.title = f.title;
      c.fixtureHash = loaded.fixtureHash;
      c.limits = f.limits;
      c.checks = loaded.checks.map((x) => ({
        id: x.check.id,
        stage: x.check.stage,
        sourceFile: x.check.sourceFile,
        sourceSha256: x.sourceHash,
        encoding: "UTF-8",
        sourceRange: x.range,
        source: x.source,
        expected: x.expected,
        transmitted: null,
        mode: x.check.mode,
        normalization: x.check.normalization,
        expectedOccurrences: x.check.expectedOccurrences,
        pass: null,
        rawPass: null,
        occurrences: null,
        diff: [],
      }));
      ev.add("isolate");
      isolation = await isolate(loaded);
      c.isolation = {
        uniqueConfig: true,
        newSession: true,
        homePreserved: true,
        excludedCanaryAbsent: true,
        onlyExpectedTools: true,
        cleanup: false,
      };
      let body:
          | { text: string; messageIndex: number; blockIndex: number }
          | undefined,
        reference:
          | {
              text: string;
              messageIndex: number;
              blockIndex: number;
              requestOrdinal: number;
            }
          | undefined,
        readFailed: string | undefined;
      const toolId = "sp_read_" + randomUUID(),
        credential = "skillparcel-synthetic-" + randomUUID();
      ev.add("start-endpoint");
      endpoint = await startEndpoint({
        credential,
        requestBytes: f.limits.requestBytes,
        turns: f.limits.turns,
        ...(options.privateDir
          ? { privateDir: join(options.privateDir, f.id, randomUUID()) }
          : {}),
        onFault: () => abort.abort(),
        onRequest: (q) => {
          c.evidenceRefs.push({ requestOrdinal: q.ordinal, bytes: q.bytes });
          if (JSON.stringify(q.body).includes(isolation!.canary)) {
            c.isolation!.excludedCanaryAbsent = false;
            throw new ParcelError(
              "isolation-canary",
              "Excluded synthetic customization appeared in request",
            );
          }
          const tools = q.body.tools?.map((t) => t.name) ?? [];
          if (
            tools.some((t) => t !== "Read") ||
            (!f.referenceRead?.request && tools.length)
          ) {
            c.isolation!.onlyExpectedTools = false;
            throw new ParcelError(
              "unexpected-tool",
              "Unexpected native tool exposed",
            );
          }
          if (q.ordinal === 1) {
            body = bodyBlock(q.body, isolation!.skillPath);
            c.observedStages.push("body");
            ev.add("body-observed", { requestOrdinal: 1 });
            if (f.referenceRead) {
              const referenceBytes = decode(
                loaded.files.get(f.referenceRead.path)!,
              );
              if (
                referenceBytes.length &&
                q.body.messages.some((m) =>
                  (typeof m.content === "string"
                    ? m.content
                    : m.content
                        .filter((b) => b.type === "text")
                        .map((b) => b.text ?? "")
                        .join("")
                  ).includes(referenceBytes),
                )
              )
                throw new ParcelError(
                  "reference-premature",
                  "Reference was already present before native Read",
                );
              if (f.referenceRead.request) {
                ev.add("optional-read-requested", {
                  requestOrdinal: 1,
                  toolUseId: toolId,
                  detail: "forced native Read path",
                });
                return [
                  {
                    type: "tool_use",
                    id: toolId,
                    name: "Read",
                    input: {
                      file_path: join(
                        isolation!.skillPath,
                        f.referenceRead.path.slice(f.skillDirectory.length + 1),
                      ),
                    },
                  },
                ];
              }
            }
          } else if (f.referenceRead?.request && q.ordinal === 2) {
            const match = toolResult(q.body, toolId);
            if (match.block.is_error)
              readFailed =
                resultText(match.block).toLowerCase().includes("denied") ||
                resultText(match.block).toLowerCase().includes("permission")
                  ? "read-denied"
                  : "read-error";
            else
              reference = {
                text: readFragment(resultText(match.block)),
                messageIndex: match.messageIndex,
                blockIndex: match.blockIndex,
                requestOrdinal: q.ordinal,
              };
          } else if (q.ordinal > 2)
            throw new ParcelError(
              "unexpected-turn",
              "Unexpected extra native request",
            );
          return [
            { type: "text", text: "SkillParcel synthetic endpoint completed." },
          ];
        },
      });
      ev.add("start-native");
      ev.add("invoked", {
        detail: "Explicit native /" + f.invocation.commandName,
      });
      await assertNoDrift(loaded);
      const processResult = await runProcess(
        executable,
        nativeArguments(
          isolation.project,
          isolation.skillPath,
          loaded,
          isolation.sessionId,
        ),
        isolation.project,
        nativeEnvironment(
          isolation.root,
          isolation.config,
          endpoint.url,
          credential,
        ),
        f.limits.timeoutMs,
        abort.signal,
      );
      c.nativeExitCode = processResult.exitCode;
      await assertNoDrift(loaded);
      if (endpoint.fault) throw endpoint.fault;
      if (f.referenceRead?.request) {
        const executed = processResult.events
          .flatMap((e) => (e.type === "user" ? (e.message?.content ?? []) : []))
          .find((b) => b.type === "tool_result" && b.tool_use_id === toolId);
        const denied = processResult.events.some((e) =>
          e.permission_denials?.some((p) => p.tool_name === "Read"),
        );
        if (readFailed || denied)
          throw new ParcelError(
            readFailed ?? "read-denied",
            "Forced native Read was denied or failed",
          );
        if (!executed)
          throw new ParcelError(
            "read-unobserved",
            "No correlated native CLI tool result",
          );
        ev.add("read-executed", { toolUseId: toolId });
        if (!reference)
          throw new ParcelError(
            "read-succeeded-but-not-transmitted",
            "Read executed but its result was not sent to endpoint",
          );
        ev.add("read-result-transmitted", {
          requestOrdinal: reference.requestOrdinal,
          toolUseId: toolId,
        });
        c.observedStages.push("reference-read");
      } else c.omissions.push("Reference Read was not requested or measured");
      ev.add("compared");
      for (let i = 0; i < loaded.checks.length; i++) {
        const x = loaded.checks[i]!,
          out = c.checks[i]!;
        const observed = x.check.stage === "body" ? body : reference;
        if (!observed)
          throw new ParcelError(
            "stage-unobserved",
            "Required stage was not observed",
          );
        let selector = x.check;
        if (x.check.sourceRange && x.check.stage === "body") {
          const source = decode(loaded.files.get(x.check.sourceFile)!);
          const header = /^---\r?\n[\s\S]*?\r?\n---\r?\n/.exec(source)![0];
          selector = {
            ...x.check,
            sourceRange: {
              startByte:
                x.check.sourceRange.startByte - Buffer.byteLength(header),
              endByte: x.check.sourceRange.endByte - Buffer.byteLength(header),
            },
          };
          if (selector.sourceRange!.startByte < 0)
            throw new ParcelError(
              "selector",
              "Body byte selector overlaps frontmatter",
            );
        }
        let actual: string;
        try {
          actual = select(observed.text, selector);
        } catch {
          throw new ParcelError(
            "unobserved-fragment",
            "Required sentinels or byte range were not observed",
          );
        }
        if (Buffer.byteLength(actual) > 262144)
          throw new ParcelError(
            "fragment-limit",
            "Selected transmitted fragment exceeds 256 KiB",
          );
        const judged = compare(actual, x.expected, x.check);
        out.transmitted = actual;
        out.pass = judged.pass;
        out.rawPass = judged.rawPass;
        out.occurrences = judged.occurrences;
        out.diff = judged.diff;
        out.evidenceRef = {
          requestOrdinal:
            x.check.stage === "body" ? 1 : reference!.requestOrdinal,
          messageIndex: observed.messageIndex,
          blockIndex: observed.blockIndex,
          ...(x.check.stage === "reference-read" ? { toolUseId: toolId } : {}),
        };
      }
      c.contractStatus = c.checks.every((x) => x.pass === true)
        ? "pass"
        : "violation";
      c.measurementStatus = "complete";
      c.outcome = !identity.verified ? "unsupported" : c.contractStatus;
      ev.add("completed");
      if (!identity.verified) {
        c.reasonCode = "unverified-client";
        c.reason = "Diagnostic native build; verified coverage is withheld";
      }
    } catch (e) {
      const error =
        endpoint?.fault ??
        (e instanceof ParcelError
          ? e
          : new ParcelError(
              "input-or-io",
              "Fixture validation or local I/O failed",
            ));
      const unsupported =
        /^(unsupported|body-unobserved|stage-unobserved|unobserved|read-denied|read-unobserved|read-succeeded)/.test(
          error.code,
        );
      c.outcome =
        error.code === "cancelled"
          ? "cancelled"
          : unsupported
            ? "unsupported"
            : "error";
      c.measurementStatus = c.outcome;
      c.reasonCode = error.code;
      c.reason = error.message;
      c.contractStatus = "not-measured";
      ev.add("stopped", { detail: error.code });
    } finally {
      await endpoint?.close();
      await isolation?.cleanup();
      if (c.isolation) c.isolation.cleanup = true;
      ev.add("cleanup");
      options.signal?.removeEventListener("abort", forward);
    }
    report.cases.push(c);
    if (c.outcome === "cancelled") break;
  }
  report.exitCode = exitPriority(report.cases.map(caseExit));
  return report;
}

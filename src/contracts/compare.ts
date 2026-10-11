import { diffLines } from "diff";
import type { Check } from "../fixtures/schema.js";
export const normalize = (s: string, rule: Check["normalization"]) =>
  rule === "crlf-to-lf" ? s.replaceAll("\r\n", "\n") : s;
export function occurrences(s: string, needle: string) {
  if (!needle.length) return s.length === 0 ? 1 : 0;
  let count = 0,
    at = 0;
  while ((at = s.indexOf(needle, at)) !== -1) {
    count++;
    at += needle.length;
  }
  return count;
}
export function compare(
  actual: string,
  expected: string,
  check: Pick<Check, "mode" | "normalization" | "expectedOccurrences">,
) {
  const judge = (a: string, e: string) =>
    check.mode === "exact-text"
      ? a === e && check.expectedOccurrences === 1
      : occurrences(a, e) === check.expectedOccurrences;
  const rawPass = judge(actual, expected);
  const pass = judge(
    normalize(actual, check.normalization),
    normalize(expected, check.normalization),
  );
  return {
    pass,
    rawPass,
    normalized: check.normalization !== "none",
    occurrences: occurrences(
      normalize(actual, check.normalization),
      normalize(expected, check.normalization),
    ),
    diff: (
      diffLines(expected, actual, { timeout: 100, maxEditLength: 1000 }) ?? [
        { removed: true, added: false, value: expected },
        { added: true, removed: false, value: actual },
      ]
    ).map((p) => ({
      kind: p.added ? "added" : p.removed ? "removed" : "equal",
      text: p.value,
    })),
  };
}

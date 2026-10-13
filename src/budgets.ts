import { BudgetError, ParcelError } from "./errors.js";

// JSON schema v1 is unchanged. These byte limits are the admission policy.
export const budgets = Object.freeze({
  reportBytes: 64 * 1024 * 1024,
  suiteInputBytes: 8 * 1024 * 1024,
  fixtureJsonBytes: 128 * 1024,
  sourceFragmentBytes: 128 * 1024,
  transmittedFragmentBytes: 256 * 1024,
  cases: 50,
  diffParts: 10000,
  events: 100,
});

export function assertBudget(
  bytes: number,
  limit: number,
  code: string,
  resource: string,
) {
  if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > limit)
    throw new BudgetError(code, resource, bytes, limit);
}

// Count JSON escapes without allocating an escaped copy. Paired surrogates
// become four UTF-8 bytes; lone surrogates become six-byte JSON escapes.
export function jsonStringBytes(text: string): number {
  let bytes = 2;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code === 34 || code === 92 || [8, 9, 10, 12, 13].includes(code))
      bytes += 2;
    else if (code < 32) bytes += 6;
    else if (code >= 0xd800 && code <= 0xdbff) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        i++;
      } else bytes += 6;
    } else if (code >= 0xdc00 && code <= 0xdfff) bytes += 6;
    else bytes += code < 128 ? 1 : code < 2048 ? 2 : 3;
  }
  return bytes;
}

// Safe upper bound for JSON.stringify(data, null, 2) + newline. For plain
// schema data it is exact, including indentation, keys and UTF-8 escapes.
export function reportBytesUpperBound(data: unknown): number {
  const ancestors = new Set<object>();
  function count(value: unknown, depth: number): number {
    if (typeof value === "string") return jsonStringBytes(value);
    if (value === null) return 4;
    if (typeof value === "boolean") return value ? 4 : 5;
    if (typeof value === "number") return JSON.stringify(value).length;
    if (typeof value !== "object" || depth > 30 || ancestors.has(value))
      throw new ParcelError("report-json", "Expected acyclic JSON report data");
    ancestors.add(value);
    const array = Array.isArray(value);
    const record = value as Record<string, unknown>;
    const keys = array
      ? undefined
      : Object.keys(value).filter((key) => record[key] !== undefined);
    const length = array ? value.length : keys!.length;
    let bytes = length
      ? 3 + length * (2 * (depth + 1) + 1) + length - 1 + 2 * depth
      : 2;
    assertBudget(bytes, budgets.reportBytes, "report-limit", "JSON report");
    for (let i = 0; i < length; i++) {
      const key = keys?.[i];
      const item = array ? (value[i] ?? null) : record[key!];
      bytes += (array ? 0 : jsonStringBytes(key!) + 2) + count(item, depth + 1);
      assertBudget(bytes, budgets.reportBytes, "report-limit", "JSON report");
    }
    ancestors.delete(value);
    return bytes;
  }
  const bytes = count(data, 0) + 1;
  assertBudget(bytes, budgets.reportBytes, "report-limit", "JSON report");
  return bytes;
}

export function boundedReportJson(data: unknown): string {
  reportBytesUpperBound(data);
  const json = JSON.stringify(data, null, 2) + "\n";
  assertBudget(
    Buffer.byteLength(json, "utf8"),
    budgets.reportBytes,
    "report-limit",
    "JSON report",
  );
  return json;
}

export function checkReportReservation(
  source: string,
  expected: string,
): number {
  // The raw diff partitions at most expected + transmitted text. Each
  // future UTF-8 byte needs at most six JSON bytes. Reserve all 10,000
  // schema-permitted diff rows and their indentation, without predicting
  // what the native client will transmit or trimming any captured evidence.
  return (
    4096 +
    jsonStringBytes(source) +
    2 * jsonStringBytes(expected) +
    2 * 6 * budgets.transmittedFragmentBytes +
    128 * budgets.diffParts
  );
}

export const reportHeaderReservation = 128 * 1024;
export const caseMetadataReservation = 256 * 1024;

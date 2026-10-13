import { loadFixture, discover, type Loaded } from "./loader.js";
import { ParcelError } from "../errors.js";
import {
  budgets,
  assertBudget,
  checkReportReservation,
  reportHeaderReservation,
  caseMetadataReservation,
} from "../budgets.js";

export interface Preflight {
  cases: Loaded[];
  inputBytes: number;
  reportUpperBoundBytes: number;
}

export async function preflightDirectories(dirs: string[]): Promise<Preflight> {
  if (!dirs.length || dirs.length > budgets.cases)
    throw new ParcelError(
      "case-count",
      "Expected between 1 and 50 intentional local cases",
    );
  const cases: Loaded[] = [];
  const ids = new Set<string>();
  let inputBytes = 0,
    reportUpperBoundBytes = reportHeaderReservation;
  for (const dir of dirs) {
    const loaded = await loadFixture(dir);
    if (ids.has(loaded.fixture.id))
      throw new ParcelError("duplicate-case", "Suite case IDs must be unique");
    ids.add(loaded.fixture.id);
    for (const bytes of loaded.files.values()) inputBytes += bytes.length;
    assertBudget(
      inputBytes,
      budgets.suiteInputBytes,
      "suite-limit",
      "Fixture suite input",
    );
    reportUpperBoundBytes += caseMetadataReservation;
    for (const check of loaded.checks)
      reportUpperBoundBytes += checkReportReservation(
        check.source,
        check.expected,
      );
    assertBudget(
      reportUpperBoundBytes,
      budgets.reportBytes,
      "report-limit",
      "Native report reservation",
    );
    cases.push(loaded);
  }
  return { cases, inputBytes, reportUpperBoundBytes };
}

export async function preflight(dir: string): Promise<Preflight> {
  return preflightDirectories(await discover(dir));
}

export function validationResult(result: Preflight) {
  return {
    schemaVersion: 1,
    command: "validate",
    valid: true,
    coverage: "portable-only",
    nativeSpawned: false,
    caseCount: result.cases.length,
    inputBytes: result.inputBytes,
    reportUpperBoundBytes: result.reportUpperBoundBytes,
    limits: {
      suiteInputBytes: budgets.suiteInputBytes,
      reportBytes: budgets.reportBytes,
    },
    cases: result.cases.map((loaded) => ({
      id: loaded.fixture.id,
      fixtureHash: loaded.fixtureHash,
      checks: loaded.checks.length,
    })),
  };
}

import { budgets } from "../budgets.js";
import { boundedFile, decode } from "../fixtures/loader.js";
import { ParcelError } from "../errors.js";
import { publicReport } from "./json.js";

export async function readReport(path: string) {
  const bytes = await boundedFile(path, budgets.reportBytes);
  let value: unknown;
  try {
    value = JSON.parse(decode(bytes));
  } catch {
    throw new ParcelError("report-json", "Report must be valid UTF-8 JSON");
  }
  return publicReport(value);
}

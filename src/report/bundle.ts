import { open, rm } from "node:fs/promises";
import { join } from "node:path";
import { outputDirectory } from "../output.js";
import { serializeReport, type Report } from "./json.js";
import { html } from "./html.js";
import { junit } from "./junit.js";

export async function saveBundle(report: Report, out: string) {
  // Every admission check and renderer finishes before reserving output.
  const bundle = [
    ["report.json", serializeReport(report)],
    ["report.html", await html(report)],
    ["junit.xml", junit(report)],
  ] as const;
  const dir = await outputDirectory(out);
  const written: string[] = [];
  try {
    for (const [name, text] of bundle) {
      const path = join(dir, name);
      const handle = await open(path, "wx");
      written.push(path);
      try {
        await handle.writeFile(text, "utf8");
      } finally {
        await handle.close();
      }
    }
  } catch (error) {
    for (const path of written) await rm(path);
    throw error;
  } finally {
    await rm(join(dir, ".skillparcel-output-lock"));
  }
  return dir;
}

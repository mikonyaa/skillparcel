import { mkdir, readFile, writeFile } from "node:fs/promises";
import { html } from "../dist/report/html.js";
import { reportSchema } from "../dist/report/json.js";
const report = reportSchema.parse(
  JSON.parse(await readFile("examples/report.json", "utf8")),
);
report.recorded = true;
await mkdir("site", { recursive: true });
await writeFile("examples/report.html", await html(report));
await writeFile("site/index.html", await html(report));
await writeFile("site/.nojekyll", "");

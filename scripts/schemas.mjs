import { z } from "zod";
import { writeFile } from "node:fs/promises";
import { fixtureSchema } from "../dist/fixtures/schema.js";
import { reportSchema } from "../dist/report/json.js";
await writeFile(
  "docs/fixture.schema.json",
  JSON.stringify(z.toJSONSchema(fixtureSchema), null, 2) + "\n",
);
await writeFile(
  "docs/report.schema.json",
  JSON.stringify(z.toJSONSchema(reportSchema), null, 2) + "\n",
);

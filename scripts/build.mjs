import { copyFile, chmod } from "node:fs/promises";
for (const name of ["viewer.css", "viewer.js"])
  await copyFile("src/report/" + name, "dist/report/" + name);
await chmod("dist/cli/main.js", 0o755);

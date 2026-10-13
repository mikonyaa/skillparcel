import { mkdir, readdir, writeFile } from "node:fs/promises";
import { resolve, dirname, join } from "node:path";
import { ParcelError } from "./errors.js";

export async function outputDirectory(dir: string) {
  const path = resolve(dir);
  await mkdir(dirname(path), { recursive: true });
  try {
    await mkdir(path, { recursive: false });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    if ((await readdir(path)).length)
      throw new ParcelError(
        "output-exists",
        "Use a new or empty output directory",
      );
  }
  await writeFile(
    join(path, ".skillparcel-output-lock"),
    "Owned SkillParcel output reservation\n",
    { flag: "wx" },
  );
  return path;
}

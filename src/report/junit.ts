import type { Report } from "./json.js";
const xml = (s: string) =>
  Array.from(s)
    .filter((c) => {
      const code = c.codePointAt(0)!;
      return code >= 32 || code === 9 || code === 10 || code === 13;
    })
    .join("")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
export function junit(report: Report) {
  let failures = 0,
    errors = 0,
    skipped = 0;
  const rows: string[] = [];
  for (const c of report.cases) {
    const checks = c.checks.length
      ? c.checks
      : [{ id: "measurement", pass: null, expected: "", transmitted: null }];
    for (const check of checks) {
      let content = "";
      if (
        c.outcome === "error" ||
        c.outcome === "cancelled" ||
        (!c.checks.length && c.outcome !== "unsupported")
      ) {
        errors++;
        content = `<error message="${xml(c.reason ?? "No checks measured")}"/>`;
      } else if (c.outcome === "unsupported" || check.pass === null) {
        skipped++;
        content = `<skipped message="${xml(c.reason ?? "Stage not measured")}"/>`;
      } else if (check.pass === false) {
        failures++;
        content = `<failure message="Measured contract violation">${xml("Expected:\n" + check.expected + "\nTransmitted:\n" + check.transmitted)}</failure>`;
      }
      rows.push(
        `<testcase classname="${xml(c.id)}" name="${xml(check.id)}">${content}</testcase>`,
      );
    }
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n<testsuite name="SkillParcel" tests="${rows.length}" failures="${failures}" errors="${errors}" skipped="${skipped}">\n${rows.join("\n")}\n</testsuite>\n`;
}

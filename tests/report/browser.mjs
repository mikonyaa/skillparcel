import { chromium } from "playwright";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";
import { html } from "../../dist/report/html.js";
const out = resolve("work/report-qa");
await mkdir(out, { recursive: true });
const report = JSON.parse(await readFile("examples/report.json", "utf8"));
await writeFile(join(out, "recorded.html"), await html(report));
const empty = {
  ...report,
  coverage: "portable-only",
  nativeVersion: "unmeasured",
  nativeSha256: "",
  cases: [],
  exitCode: 3,
};
await writeFile(join(out, "empty.html"), await html(empty));
const extra = structuredClone(report);
extra.coverage = "portable-only";
extra.nativeVersion = "unmeasured";
extra.nativeSha256 = "";
extra.cases = [
  {
    ...extra.cases[0],
    id: "unsupported-input",
    title: "Unsupported stage · a-very-long-file-name-" + "world-".repeat(20),
    outcome: "unsupported",
    measurementStatus: "unsupported",
    contractStatus: "not-measured",
    reasonCode: "unsupported-read-wrapper",
    reason:
      "New wrapper is not measured. Upgrade the adapter after verification",
    observedStages: [],
    checks: [],
    evidence: [],
    evidenceRefs: [],
  },
  {
    ...extra.cases[0],
    id: "error-input",
    title: "Explicit input error",
    outcome: "error",
    measurementStatus: "error",
    contractStatus: "not-measured",
    reasonCode: "missing-reference",
    reason: "Declared reference file is missing",
    observedStages: [],
    checks: [],
    evidence: [],
    evidenceRefs: [],
  },
];
extra.exitCode = 2;
await writeFile(join(out, "states.html"), await html(extra));
const hostile = structuredClone(report);
hostile.coverage = "portable-only";
hostile.nativeVersion = "unmeasured";
hostile.nativeSha256 = "";
hostile.cases[0].title =
  "</script><script>globalThis.SKILLPARCEL_ATTACK=true</script>\u001b[31m\u202e";
hostile.cases[0].checks[0].sourceFile =
  "very-long-" + "path-".repeat(35) + "/SKILL.md";
hostile.cases[0].checks[0].source += "\n\u001b[31m\u202e";
await writeFile(join(out, "hostile.html"), await html(hostile));
const browser = await chromium.launch();
const results = [];
try {
  for (const width of [1440, 1024, 390]) {
    const context = await browser.newContext({
      viewport: { width, height: 1000 },
    });
    const page = await context.newPage();
    const requests = [];
    const errors = [];
    page.on("request", (r) => requests.push(r.url()));
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(pathToFileURL(join(out, "recorded.html")).href);
    await page
      .getByRole("heading", {
        name: "Dollar digits with seven explicit arguments",
        exact: true,
      })
      .waitFor();
    await page.locator("#filter").selectOption("violation");
    assert.equal(await page.locator("#cases tr").count(), 2);
    await page
      .getByRole("button", { name: "Select case dollar-digit", exact: true })
      .click();
    await page.getByText("Stage evidence (").first().count();
    await page.locator("#detail summary").last().click();
    assert.match(await page.locator("#detail").innerText(), /body-observed/);
    await page.screenshot({
      path: join(out, "violation-" + width + ".png"),
      fullPage: true,
    });
    await page.locator("#filter").selectOption("all");
    await page
      .getByRole("button", { name: "Select case reference-read", exact: true })
      .click();
    await page.locator("#detail summary").last().click();
    assert.match(
      await page.locator("#detail").innerText(),
      /read-result-transmitted/,
    );
    assert.match(await page.locator("#detail").innerText(), /sp_read_/);
    await page.screenshot({
      path: join(out, "reference-" + width + ".png"),
      fullPage: true,
    });
    await page
      .getByRole("button", { name: "Select case repeated-html", exact: true })
      .click();
    assert.equal(
      await page.evaluate(() => globalThis.SKILLPARCEL_ATTACK),
      undefined,
    );
    const overflow = await page
      .locator("#detail pre")
      .evaluateAll((items) => items.some((x) => x.scrollWidth > x.clientWidth));
    assert.equal(overflow, true);
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
      true,
    );
    await page.locator("#filter").focus();
    await page.keyboard.press("Tab");
    assert.equal(
      await page.evaluate(() => document.activeElement.tagName),
      "BUTTON",
    );
    await page.locator("#filter").selectOption("unsupported");
    assert.equal(await page.locator("#empty").isVisible(), true);
    await page.goto(pathToFileURL(join(out, "states.html")).href);
    await page
      .getByRole("button", {
        name: "Select case unsupported-input",
        exact: true,
      })
      .click();
    assert.match(
      await page.locator("#detail").innerText(),
      /unsupported-read-wrapper/,
    );
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
      true,
    );
    await page.screenshot({
      path: join(out, "unsupported-" + width + ".png"),
      fullPage: true,
    });
    await page
      .getByRole("button", { name: "Select case error-input", exact: true })
      .click();
    assert.match(
      await page.locator("#detail").innerText(),
      /missing-reference/,
    );
    await page.goto(pathToFileURL(join(out, "hostile.html")).href);
    await page
      .getByRole("button", {
        name: "Select case argument-substitution",
        exact: true,
      })
      .click();
    assert.equal(
      await page.evaluate(() => globalThis.SKILLPARCEL_ATTACK),
      undefined,
    );
    assert.match(await page.locator("#detail").innerText(), /\\u001b/);
    await page.goto(pathToFileURL(join(out, "empty.html")).href);
    assert.match(
      await page.locator("#detail").innerText(),
      /No cases were measured/,
    );
    await page.evaluate(() => {
      Object.defineProperty(navigator, "clipboard", {
        value: { writeText: () => Promise.reject(Error("denied")) },
        configurable: true,
      });
    });
    await page
      .getByRole("button", { name: "Copy native demo command", exact: true })
      .click();
    await page.locator("#command").waitFor({ state: "visible" });
    assert.equal(errors.length, 0, errors.join("\n"));
    assert.equal(
      requests.some((url) => url.startsWith("http")),
      false,
    );
    results.push({
      width,
      fileReport: true,
      filters: true,
      evidence: true,
      keyboard: true,
      emptyErrorUnsupported: true,
      longCodeScroll: true,
      noPageOverflow: true,
      htmlPayloadSafe: true,
      clipboardFallback: true,
      externalRequests: 0,
    });
    await context.close();
  }
  await writeFile(
    join(out, "qa.json"),
    JSON.stringify({ browser: browser.version(), results }, null, 2) + "\n",
  );
  console.log(
    JSON.stringify({
      browser: browser.version(),
      viewports: results.map((x) => x.width),
      passed: results.length,
      externalRequests: 0,
    }),
  );
} finally {
  await browser.close();
}

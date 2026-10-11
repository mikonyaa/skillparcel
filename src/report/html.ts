import { readFile } from "node:fs/promises";
import { publicReport } from "./json.js";
import type { Report } from "./json.js";
export function safeJson(x: unknown) {
  return JSON.stringify(x)
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e")
    .replaceAll("&", "\\u0026")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
}
export async function html(report: Report) {
  const [css, script] = await Promise.all([
    readFile(new URL("./viewer.css", import.meta.url), "utf8"),
    readFile(new URL("./viewer.js", import.meta.url), "utf8"),
  ]);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; base-uri 'none'"><title>SkillParcel · Native transmission report</title><style>${css}</style></head><body><main><header><p class="eyebrow">SKILLPARCEL / TRANSMISSION LAB</p><h1>What reached the endpoint.</h1><p id="coverage"></p><p id="recorded"></p><div class="rail" aria-label="Measured pipeline">SOURCE <span>→</span> NATIVE LOAD <span>→</span> HTTP CAPTURE <span>→</span> FORCED READ</div></header><section aria-labelledby="cases-heading"><div class="section-head"><h2 id="cases-heading">Fixture contracts</h2><label>Filter outcome <select id="filter"><option value="all">All outcomes</option><option>pass</option><option>violation</option><option>error</option><option>unsupported</option><option>cancelled</option></select></label></div><p id="summary" aria-live="polite"></p><div class="table-scroll"><table><thead><tr><th>Case</th><th>Outcome</th><th>Measured stages</th><th>Checks</th></tr></thead><tbody id="cases"></tbody></table></div><p id="empty" hidden>No cases match this filter.</p></section><section id="detail" aria-labelledby="case-heading"></section><footer><h2>Measurement boundaries</h2><ul id="omissions"></ul><p id="network"></p><p id="versions"></p><button id="copy" type="button">Copy native demo command</button><label class="fallback" hidden>Command <input id="command" readonly value="skillparcel demo --client /absolute/path/to/claude --out ./demo-results --no-open"></label><p id="copy-status" aria-live="polite"></p></footer></main><script id="report-data" type="application/json">${safeJson(publicReport(report))}</script><script>${script}</script></body></html>`;
}

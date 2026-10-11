(() => {
  const report = JSON.parse(document.getElementById("report-data").textContent);
  const byId = (id) => document.getElementById(id);
  const node = (tag, text, className) => {
    const n = document.createElement(tag);
    if (text !== undefined)
      n.textContent = typeof text === "string" ? visible(text) : text;
    if (className) n.className = className;
    return n;
  };
  // Display escapes are separate from the original measured strings.
  const visible = (s) =>
    Array.from(s, (c) => {
      const code = c.codePointAt(0);
      if (code === 13) return "␍";
      if (
        (code < 32 && code !== 9 && code !== 10) ||
        (code >= 127 && code <= 159) ||
        (code >= 0x202a && code <= 0x202e) ||
        (code >= 0x2066 && code <= 0x2069) ||
        code === 0x200e ||
        code === 0x200f
      )
        return "\\u" + code.toString(16).padStart(4, "0");
      return c;
    }).join("");
  byId("coverage").textContent =
    `Claude Code ${report.nativeVersion} · ${report.OS}/${report.arch} · ${report.coverage}`;
  byId("recorded").textContent =
    (report.recorded
      ? "RECORDED synthetic captured run; this does not verify this machine. "
      : "Synthetic captured run. ") + report.recordedAt;
  byId("network").textContent = report.networkMode;
  byId("versions").textContent =
    `SkillParcel ${report.toolVersion} · adapter ${report.adapterVersion}` +
    (report.sourceCommit
      ? ` · source ${report.sourceCommit}`
      : " · source commit not supplied");
  for (const omission of report.omissions)
    byId("omissions").append(node("li", omission));
  let selected = -1;
  function detail(index) {
    selected = index;
    const c = report.cases[index],
      host = byId("detail");
    host.replaceChildren();
    host.append(node("h2", c.title));
    host.firstChild.id = "case-heading";
    host.append(
      node(
        "p",
        `${c.outcome.toUpperCase()} · measurement ${c.measurementStatus} · contract ${c.contractStatus}`,
        "status " + c.outcome,
      ),
    );
    if (c.reason)
      host.append(
        node(
          "p",
          `${c.reasonCode}: ${c.reason}. Review the fixture or adapter support before rerunning.`,
          "reason",
        ),
      );
    host.append(
      node("p", `Fixture SHA-256 ${c.fixtureHash || "unavailable"}`, "meta"),
    );
    for (const check of c.checks) {
      const article = node("article", undefined, "check");
      article.append(node("h3", check.id));
      article.append(
        node(
          "p",
          `${check.stage} · ${check.sourceFile} · bytes ${check.sourceRange.startByte}–${check.sourceRange.endByte} · UTF-8`,
          "meta",
        ),
      );
      article.append(
        node(
          "p",
          `${check.mode} · normalization ${check.normalization} · raw ${check.rawPass === null ? "unmeasured" : check.rawPass ? "pass" : "different"} · verdict ${check.pass === null ? "unmeasured" : check.pass ? "pass" : "violation"}`,
          "meta",
        ),
      );
      const panes = node("div", undefined, "panes");
      for (const [label, text] of [
        ["Source bytes (decoded)", check.source],
        ["Transmitted API fragment", check.transmitted ?? "Stage not measured"],
      ]) {
        const pane = node("div");
        pane.append(node("h3", label), node("pre", visible(text)));
        panes.append(pane);
      }
      article.append(panes);
      const gold = node("details");
      gold.append(
        node("summary", "Author contract / expected text"),
        node("pre", visible(check.expected)),
      );
      article.append(gold);
      if (check.diff.length) {
        article.append(node("h3", "Expected → transmitted diff"));
        const pre = node("pre", undefined, "diff");
        for (const diff of check.diff)
          pre.append(
            node(
              "span",
              (diff.kind === "added"
                ? "+ "
                : diff.kind === "removed"
                  ? "- "
                  : "  ") + visible(diff.text),
              diff.kind,
            ),
          );
        article.append(pre);
      }
      if (check.evidenceRef)
        article.append(
          node(
            "p",
            `request #${check.evidenceRef.requestOrdinal} · user message ${check.evidenceRef.messageIndex}, block ${check.evidenceRef.blockIndex}` +
              (check.evidenceRef.toolUseId
                ? ` · ${check.evidenceRef.toolUseId}`
                : ""),
            "meta",
          ),
        );
      host.append(article);
    }
    const evidence = node("details");
    evidence.append(
      node("summary", "Stage evidence (" + c.evidence.length + " events)"),
    );
    const list = node("ol", undefined, "evidence");
    for (const e of c.evidence)
      list.append(
        node(
          "li",
          `+${e.elapsedMs} ms · ${e.stage}` +
            (e.requestOrdinal ? ` · request #${e.requestOrdinal}` : "") +
            (e.toolUseId ? ` · ${e.toolUseId}` : "") +
            (e.detail ? ` · ${e.detail}` : ""),
        ),
      );
    evidence.append(list);
    host.append(evidence);
    for (const omitted of c.omissions) host.append(node("p", omitted, "meta"));
    renderRows();
  }
  function renderRows() {
    const filter = byId("filter").value;
    const tbody = byId("cases");
    tbody.replaceChildren();
    let shown = 0;
    report.cases.forEach((c, index) => {
      if (filter !== "all" && c.outcome !== filter) return;
      shown++;
      const tr = node("tr");
      tr.setAttribute("aria-selected", String(index === selected));
      const title = node("td");
      const button = node("button", c.title);
      button.type = "button";
      button.setAttribute("aria-label", "Select case " + c.id);
      button.addEventListener("click", () => {
        detail(index);
        byId("case-heading").setAttribute("tabindex", "-1");
        byId("case-heading").focus();
      });
      title.append(button, node("div", c.id, "meta"));
      tr.append(
        title,
        node("td", c.outcome, "status " + c.outcome),
        node("td", c.observedStages.join(" + ") || "unmeasured"),
        node(
          "td",
          `${c.checks.filter((x) => x.pass !== null).length}/${c.checks.length}`,
        ),
      );
      tbody.append(tr);
    });
    byId("empty").hidden = shown !== 0;
    byId("summary").textContent =
      `${shown} visible / ${report.cases.length} cases · exit ${report.exitCode} · controls are escaped for display; text comparison used the original characters`;
  }
  byId("filter").addEventListener("change", () => {
    const index = report.cases.findIndex(
      (c) =>
        byId("filter").value === "all" || c.outcome === byId("filter").value,
    );
    if (index >= 0) detail(index);
    else {
      selected = -1;
      byId("detail").replaceChildren(node("p", "No measured case selected."));
      renderRows();
    }
  });
  byId("copy").addEventListener("click", async () => {
    const text = byId("command").value;
    try {
      await navigator.clipboard.writeText(text);
      byId("copy-status").textContent = "Command copied.";
    } catch {
      document.querySelector(".fallback").hidden = false;
      byId("command").focus();
      byId("command").select();
      byId("copy-status").textContent = "Select and copy the command above.";
    }
  });
  if (report.cases.length)
    detail(
      Math.max(
        0,
        report.cases.findIndex((c) => c.outcome === "violation"),
      ),
    );
  else {
    byId("detail").append(
      node("p", "No cases were measured. This report cannot pass."),
    );
    renderRows();
  }
})();

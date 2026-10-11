# Local acceptance — 2026-10-12

The local release gate ran on an Apple M4, macOS 26.7.1 (25G241), Node 24.21.0. Native evidence uses the separately installed Anthropic-signed **Claude Code 2.1.280**, arm64, SHA-256 `387a5c5dcdbb815085edf0baf79591f9d8894efe922bceaf3d75b1b08055229d`. No personal account credentials or paid inference were supplied to the client.

| Check | Observed result |
| --- | --- |
| TypeScript and ESLint | Passed |
| Portable unit tests | 28 passed, 0 failed, 0 skipped; strict fixture/report schemas, comparator mutations, UTF-8/CRLF, path containment, FIFO refusal, bounded protocol/process handling, identity stand-in rejection and owned cleanup |
| Native corpus | All 11 cases repeated three times; stable substantive fragments and verdicts: 9 passing cases, 2 expected measured contract violations |
| Forced Read | Reference absent before Read; native execution and the next HTTP request correlated by the same `tool_use_id`; original decoded reference text passed |
| Withheld Read | Declared reference not transmitted; only body coverage reported |
| Native negative paths | Denied Read exit 3, missing reference exit 2; no empty-reference pass |
| Isolation and concurrency | Fresh project/config/session/port per case; controlled excluded canaries absent; independent parallel native runs and cleanup passed |
| Cancellation | Pre-aborted run and actual SIGINT to the owned CLI while its endpoint was active both exited 130 and cleaned their resources |
| Installed package | A `.tgz` installed in an OS temporary consumer outside the checkout with `--omit=dev`; version, Unicode/space-path init, recorded viewer, real literal fixture and live native demo passed |
| Real terminal recording | 25 seconds; installed package stdout, original source, decoded own fragment/diff and native Read evidence; final screen held to reach 25 seconds |
| Browser | Chromium 156.0.8078.4; actual `file://` report at 1440, 1024 and 390 px; filters, evidence, keyboard focus, empty/error/unsupported, long names/code, escaped HTML/control text and clipboard fallback passed; 0 external requests/page errors |

The dollar-digit violation measured `$B$6 → $Bseven` with seven explicit arguments. The second violation is our intentionally changed source with an unchanged author golden; it is not attributed to the vendor. These expected exit-1 results are asserted, not ignored. The independent expectations live in [the native acceptance contract](../tests/native/expected-outcomes.json).

[Browser results](qa/browser-results.json) and actual screenshots: [1440](qa/violation-1440.png), [1024](qa/violation-1024.png), [390](qa/violation-390.png), [Read evidence](qa/reference-390.png), [unsupported](qa/unsupported-390.png). Screenshots were visually inspected; no overlapping controls or page-wide overflow were observed. Browser error/unsupported samples are deliberate renderer-test data, not native coverage claims.

[Terminal recording](demo/demo.cast) is an asciicast v2 file, labelled synthetic captured run with its actual date and native version. [Metadata](demo/demo-metadata.json) describes its origin. These pre-commit examples have no source commit supplied. Final release evidence is generated separately on the tagged source commit, including native consumption of the exact CI-built archive and a second consumer of the publicly downloaded archive.

Portable CI checks the tool, offline renderer and package on Linux. Native compatibility is **locally verified on macOS**, not certified by the portable badge. Coverage is limited to the pinned signed macOS arm64 build and tested explicit-command mode. Other versions/clients/OSes, default interactive behavior, model quality and voluntary reference choice are unmeasured. No OS-enforced egress sandbox is claimed.

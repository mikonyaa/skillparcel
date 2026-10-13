# Candidate native acceptance on macOS arm64

Use a clean source checkout with Node **24.21.0**, the unpublished candidate archive, and an explicitly selected separately installed native Claude Code **2.1.280** executable. Its SHA-256 must be `387a5c5dcdbb815085edf0baf79591f9d8894efe922bceaf3d75b1b08055229d`, its codesign Team ID `Q6L2SF6YDW`, and architecture macOS arm64. [Official release manifest](https://downloads.claude.ai/claude-code-releases/2.1.280/manifest.json). Stop on identity/managed-policy failure; do not open login, change the native install, bypass gates, or supply account credentials. Other builds/platforms do not gain native coverage.

Keep parallel sessions in separate checkouts. All outputs below belong only to this checkout. Confirm a clean `git status` and record the full source SHA before running; commit actual code first. Do not label historical `examples/` or QA as a new run. No push, merge or publication is part of this runbook.

From the source checkout:

```sh
npm ci
npm run typecheck
npm run lint
npm run build
npm run test:unit
npm run test:report
node scripts/schemas.mjs
git diff --exit-code -- docs/fixture.schema.json docs/report.schema.json
node dist/cli/main.js validate fixtures --json
node dist/cli/main.js doctor --client /absolute/path/to/claude --json
SKILLPARCEL_SOURCE_COMMIT="$(git rev-parse HEAD)" npm run test:native -- --client /absolute/path/to/claude --out work/candidate-native
SKILLPARCEL_QA_REPORT=work/candidate-native/report.json SKILLPARCEL_QA_OUT=work/candidate-native/browser-qa npm run test:report
mkdir -p work/candidate
npm pack --json --pack-destination work/candidate
SKILLPARCEL_SOURCE_COMMIT="$(git rev-parse HEAD)" npm run test:package -- --tarball work/candidate/skillparcel-0.1.1-rc.1.tgz --client /absolute/path/to/claude --out work/consumer-result.json
```

The unchanged original 11-case corpus is the acceptance input: literal, seven arguments, deliberate mismatch, escaped dollars, intentional arguments, LF/CRLF, Unicode/empty, repeated HTML, forced reference Read and withheld reference. The native gate asserts **9 pass + 2 deliberate violation** on each of three runs, exact substantive repeatability, body/Read correlation, two independent concurrent runs, denied Read, early missing reference, a deterministic 1 ms deadline on the verified native process (an operational probe, not a completed fixture verdict), pre-aborted cancellation and SIGINT cleanup of only the CLI it owns. Both expected violations remain exit 1 in measured reports. The acceptance script itself exits 0 only if these assertions pass. Each capture report records the candidate source commit; `acceptance.json` also records it.

The installed consumer must be outside the source checkout, use `--omit=dev --ignore-scripts`, have no `src/`, `tests/` or development packages, and verify all relative README/reachable-document targets. It creates a fixture in a path with spaces/Cyrillic/CJK, validates positive and missing/symlink/malformed UTF-8/limit negatives, exports historical recorded evidence without upgrading coverage, re-renders it, then runs its own live literal and demo. Preserve the tarball hash and consumer JSON next to source-tied native evidence.

Review the offline HTML at 1440/1024/390 px for filtering, evidence, keyboard focus, copy success/fallback, errors, long code/paths, hostile text and zero external requests. Parse JUnit independently with Python ElementTree. Verify no original fixtures or historical evidence changed. Portable tests never replace native evidence.

If the exact binary or supported machine is unavailable, finish all portable/package work and preserve ready fixtures plus this runbook. Record native acceptance as **not run** with the precise prerequisite. A real author pilot, another client/build/platform, voluntary model Read and an OS egress sandbox remain external/unverified even after this narrow native gate succeeds.

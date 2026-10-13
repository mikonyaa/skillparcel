# Authoring and portable validation

Both the [fixture schema](fixture.schema.json) and [report schema](report.schema.json) ship in the installed archive.

Use Node 24 LTS and the installed CLI. `init --dir "пример with spaces"` creates the original literal fixture. `validate "пример with spaces" --json` checks a single case or a directory containing cases, without a client, native spawn, login, endpoint, or output directory. The [authoring schema](fixture.schema.json) is included in the package. Define the expected text before measuring a native client; an intentional mismatch is a legal author contract.

Validation checks strict schema v1, unique case/check IDs, contained and unambiguous paths, regular files without symlinks, fatal UTF-8 decoding, scalar frontmatter, dynamic execution rejection, byte/sentinel selectors, declared expected files and fragment/input/suite budgets. Body byte ranges must follow frontmatter; the forced reference must reside inside the skill directory. Unused files are not copied into the native project. Hashing still includes only original case JSON and declared input bytes, without normalization or rewriting.

Successful stdout is one JSON object with `schemaVersion: 1`, `command: validate`, `valid: true`, `coverage: portable-only`, `nativeSpawned: false`, `caseCount`, `inputBytes`, `reportUpperBoundBytes`, `limits`, and cases containing `id`, `fixtureHash`, `checks`. Exit 0 means valid input. Failure stdout has the same command/coverage labels, `valid: false`, `reasonCode` and `reason`, with exit 2 and a JSON diagnostic on stderr. Usage errors go to stderr. No validation result claims a current native pass.

| Reason code                                    | Meaning                                                     |
| ---------------------------------------------- | ----------------------------------------------------------- |
| `fixture-schema`                               | Malformed JSON or invalid authoring schema                  |
| `missing-input` / `missing-reference`          | Declared source/golden or reference is absent               |
| `symlink` / `ambiguous-path` / `path-escape`   | Unsupported or unsafe path                                  |
| `utf8`                                         | Malformed source, golden or case JSON UTF-8                 |
| `frontmatter` / `dynamic-execution`            | Unsupported skill inputs                                    |
| `selector` / `stage-source` / `reference-path` | Fragment or native stage cannot be selected as declared     |
| `input-limit` / `fragment-limit`               | Per-case/file or selected source/golden byte limit          |
| `case-count` / `duplicate-case`                | Empty/oversized suite or repeated case IDs                  |
| `suite-limit` / `report-limit`                 | Aggregate input or conservative report reservation exceeded |
| `input-or-io`                                  | Other local filesystem failure                              |

The suite input cap is 8,388,608 bytes; canonical JSON report cap is 67,108,864 bytes (64 MiB). The same shared module supplies reader and serializer limits. The serializer first counts an allocation-free safe upper bound for JSON keys, escapes, indentation and UTF-8, then verifies the actual UTF-8 byte length. A reader also verifies the canonical pretty representation, so a compact external report cannot bypass that policy. Boundary-inclusive ASCII and multibyte reports round-trip; larger reports fail explicitly. Report files must be regular files with well-formed UTF-8.

Before native identity or capture, each suite reserves 128 KiB for report metadata, 256 KiB per case for bounded runtime metadata/events, and per check:

```text
4,096 + JSON(source) + 2 * JSON(expected)
      + 2 * 6 * 262,144 + 128 * 10,000 bytes
```

`JSON(text)` includes its quotes and UTF-8/escape bytes. The transmitted fragment can occupy 256 KiB; each UTF-8 byte needs at most six JSON bytes. Raw diff text is bounded by expected plus transmitted text; 10,000 diff rows are each given 128 framing bytes. Source/golden text is never truncated. This intentionally reserves for the full allowed transmission and diff, rather than guessing a native result. It may reject a small suite whose worst-case output is too large: split the suite or remove redundant checks. There is no option to bypass this reservation. The unchanged 11-case original corpus fits.

`init` validates its packaged template before writing and the copied fixture afterward. `run` validates the complete suite before checking `--client`; invalid input takes precedence over a missing/unsupported native prerequisite. Operational capture errors, unsupported measurements, cancellation, and actual violations retain distinct outcomes. An admission failure produces diagnostics and no native report bundle. Existing output files are never overwritten.

JUnit follows the XML 1.0 character ranges: TAB/LF/CR, U+0020–U+D7FF, U+E000–U+FFFD and U+10000–U+10FFFF. Forbidden characters are omitted only in XML, then markup is escaped. Astral Unicode remains intact. JSON preserves admitted original strings, including controls/noncharacters/lone-surrogate escapes. Use the JSON report for exact evidence.

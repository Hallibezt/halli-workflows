---
name: pilot-review/anchor-validator
description: Rule_link anchor resolution validator for the pilot-review orchestration pipeline. Consumes merged Finding[] (post-dedup, post-/verify-claims), reads each rule_link's target file, computes GitHub-flavored markdown heading slugs, demotes findings one tier when the anchor does not resolve, demotes to P3 when the target file itself is missing. Not a standalone command — invoked by pilot-review-orchestrator as step 8e of the aggregation pipeline.
---

**Module context**: Orchestration pipeline sub-module, consumed by `halli-workflows:pilot-review-orchestrator`. Authored per Design Doc §5 slug rules, §6 escalation, and §12 step 8e. See `docs/design/pilot-review-system-design.md` in the consuming project (`cabin`).

**Placement rationale**: This module lives under `commands/pilot-review/` because the halli-workflows plugin is pure-markdown (no TypeScript build step — see `halli-workflows:types/README.md`). Each orchestration pipeline stage is a specification document the orchestrator's inlined implementation follows. The orchestrator references this file when authoring its aggregation logic; the file is NOT an independently-registered command in `plugin.json`.

**Depends on**: `halli-workflows:types/finding.md` (canonical Finding schema), `halli-workflows:pilot-review-orchestrator` (caller). Runs AFTER dedup (T1216 module) and AFTER /verify-claims (T1217 module), BEFORE dashboard render (T1219 module).

---

## 1. Purpose

Every `rule_link` field in a reviewer finding MUST resolve to a real markdown heading on a real file (CLAUDE.md, domain CLAUDE.md, rubric file under `docs/review-rubrics/`, ADR). A `rule_link` that points at a non-existent heading is a Rule 13 signal: the reviewer either hallucinated the reference or the rule has moved. The orchestrator does not silently drop such findings — it demotes them one tier, annotates the evidence, and keeps them in the dashboard so the reviewer behavior is visible.

Per Design Doc §5, every `rule_link` MUST resolve against the target file's literal heading slug (GitHub-style). Per §12 step 8e, the orchestrator validates this in its aggregation pipeline and demotes findings whose anchor does not resolve. Per §6 escalation rules, demotion is by one tier (`P0→P1`, `P1→P2`, `P2→P3`); refuted findings are NEVER silently deleted.

## 2. Contract

### Input

```
findings: Finding[]   // canonical Finding per halli-workflows:types/finding.md
```

The input is the output of the /verify-claims pass (step 8d). Findings may already carry `REFUTED:` annotations from the verifier; this stage adds `rule_link_broken` or `rule_link_file_missing` annotations independently. A finding CAN be demoted twice in the same run (once by /verify-claims, once by the anchor check) — that is correct behavior: two independent integrity failures should compound.

### Output

```
findings: Finding[]   // same array length, possibly-demoted severities, possibly-annotated evidence
```

The output array length equals the input length. Findings are never added, never dropped — only mutated in place (severity possibly reduced by one tier, evidence possibly extended with an annotation).

### Side effects

- Reads target files via the Read tool (one read per unique target path per run; cache within the invocation)
- Emits warnings to stderr when an exempt finding carries a broken rule_link (for eventual rubric cleanup)
- Does NOT write any files
- Does NOT mutate source code
- Does NOT call external services

## 3. Algorithm

```
function validateRuleLinks(findings: Finding[], repoRoot: string): Finding[]:
    fileCache: Map<path, HeadingIndex> = empty

    for each f in findings:
        if isExempt(f):
            continue                                  // skip; §6 ceiling rules

        (targetPath, anchor) = parseRuleLink(f.rule_link)

        if targetPath is null:                         // malformed rule_link
            annotate(f, "rule_link_malformed: " + f.rule_link)
            demote(f)
            continue

        absPath = resolve(repoRoot, targetPath)

        if fileCache has no absPath:
            if not fileExists(absPath):
                fileCache[absPath] = FILE_MISSING
            else:
                content = read(absPath)
                fileCache[absPath] = buildHeadingIndex(content)

        index = fileCache[absPath]

        if index is FILE_MISSING:
            if isRubricPath(targetPath) and rubric-check module already flagged it:
                skip                                   // don't double-annotate
            annotate(f, "rule_link_file_missing: " + targetPath)
            f.severity = "P3"                          // hard-demote (not one tier)
            continue

        if anchor is null:
            // bare file reference — valid if the file exists
            continue

        if index.has(anchor):
            continue                                   // resolved; finding unchanged

        // Broken anchor — find a fuzzy suggestion for the annotation
        suggestion = closestSlug(anchor, index.allSlugs())

        annotation = "rule_link_broken: " + targetPath + "#" + anchor
        if suggestion is not null:
            annotation += " (did you mean #" + suggestion + "?)"

        annotate(f, annotation)
        demote(f)                                      // one tier

    return findings
```

### 3.1 `parseRuleLink(link)` — split path and anchor

```
function parseRuleLink(link: string) → (path: string | null, anchor: string | null):
    if link starts with "http://" or "https://":
        return (null, null)                            // external URL; out of scope (§4 Non-Goals)

    # Split on the first "#"
    hashIdx = link.indexOf("#")
    if hashIdx < 0:
        return (link, null)                            // bare file reference
    path = link.substring(0, hashIdx)
    anchor = link.substring(hashIdx + 1)
    if path == "":
        return (null, null)                            // malformed: "#foo" with no file
    return (path, anchor)
```

Edge cases:
- `"CLAUDE.md"` — bare path, anchor null. Valid if file exists.
- `"CLAUDE.md#rule-0-..."` — path + anchor. Standard case.
- `"#foo"` — anchor only, no file. Malformed.
- `"https://example.com/foo"` — external URL. Skipped (task §Out of Scope).
- `"path#with#hashes"` — first `#` splits; anchor = `"with#hashes"` (literally); will almost certainly fail to resolve. Correct behavior — let it demote.

### 3.2 `buildHeadingIndex(content)` — extract heading slugs from a file

Walk the file line by line. A line is a heading if it matches `^#{1,6}\s+(.+)$` AFTER skipping fenced code blocks (lines inside triple-backtick blocks are NOT headings). For each heading, strip the leading `#`s and whitespace, then apply the GitHub slugger algorithm (§3.3).

Because GitHub's slugger is stateful — duplicate headings get `-1`, `-2`, `-3` suffixes in source order — the index MUST track occurrence counts during extraction to mirror real GitHub anchor behavior.

```
function buildHeadingIndex(content: string) → HeadingIndex:
    slugs = new Set
    allSlugs = [] as string[]                          // insertion order preserved for fuzzy match
    occurrences = new Map<slug, int>()
    inFence = false
    fenceMarker = null

    for each line in content.split("\n"):
        # Fenced code block detection (GFM)
        fence = matchFenceStart(line)                  // ``` or ~~~ with optional info string
        if not inFence and fence:
            inFence = true
            fenceMarker = fence.marker                 // "```" or "~~~"
            continue
        if inFence:
            if matchFenceEnd(line, fenceMarker):
                inFence = false
            continue                                   // skip fenced content entirely

        m = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/)   // heading; trailing #s allowed per CommonMark
        if not m:
            continue
        headingText = m[2]
        baseSlug = githubSlug(headingText)
        if baseSlug == "":
            continue                                   // heading that slugifies to empty — skip

        count = occurrences.get(baseSlug) || 0
        if count == 0:
            finalSlug = baseSlug
        else:
            finalSlug = baseSlug + "-" + count
        occurrences.set(baseSlug, count + 1)

        slugs.add(finalSlug)
        allSlugs.push(finalSlug)

    return { has: (s) ⇒ slugs.has(s), allSlugs: () ⇒ allSlugs }
```

Notes:
- Only ATX-style headings (`#`-prefixed) are supported. Setext-style (underlined with `===` or `---`) is NOT handled in Phase 1 — neither our CLAUDE.md, design doc, nor rubric files use setext. If a rubric ever adopts setext, the validator will miss those headings and demote findings that reference them; surface as P3 `anchor_validator_uncertain` (see §6).
- HTML-style `<h2 id="...">` anchors are NOT supported. Our docs don't use them.
- Autolinked headings (`## [Heading](#heading)` display text) — the markdown-link text `[Heading]` passes through the slugger unchanged (no special parsing). Real GitHub strips the brackets via its markdown pipeline. The `[` and `]` characters are in the unicode regex so they ARE stripped — the display text survives. Verified empirically: `slug("[Heading](#ref)")` → `"headingref"`. This is a minor deviation from real GitHub behavior if a heading contains a link syntax; Phase 1 accepts this imperfection. Surface affected findings as `anchor_validator_uncertain`.

### 3.3 `githubSlug(text)` — the core slug function

**Reference implementation**: `github-slugger` v2.0.0 (`https://github.com/Flet/github-slugger`, MIT license). Verified empirically against our CLAUDE.md headings (see §8 test vectors). Do NOT add the package as a runtime dependency of the plugin (the plugin is pure markdown and has no runtime); the orchestrator that implements this algorithm in real code may choose to either vendor the package or inline the regex.

```
function githubSlug(text: string, maintainCase: boolean = false) → string:
    if typeof text !== "string":
        return ""
    if not maintainCase:
        text = text.toLowerCase()
    return text.replace(GITHUB_SLUG_REGEX, "").replace(/ /g, "-")
```

The regex `GITHUB_SLUG_REGEX` is the auto-generated Unicode character class from `github-slugger/regex.js`. It strips:
- ASCII control characters (U+0000 – U+001F)
- Most ASCII punctuation: `!` – `,` (U+0021–U+002C), `.` and `/` (U+002E–U+002F), `:` – `@` (U+003A–U+0040), `[` – `^` (U+005B–U+005E), `` ` `` (U+0060), `{` – `~` (U+007B–U+007E), plus `©«²³´¶·¹»¿×÷` and other Unicode signs
- Most non-Latin Unicode punctuation, currency symbols, emoji, and dingbats
- NOT stripped (preserved in the slug): ASCII hyphen `-` (U+002D, sits between `,` and `.` in the first range gap), underscore `_` (U+005F, sits between `^` and `` ` `` in the second range gap), space (U+0020, handled separately — converted to `-` in a second `.replace` pass), digits `0-9`, letters (any case), and the full range of Latin-with-diacritics (e.g. `é`, `ä`, `ñ`)

**Rule 13 empirical-confirmation call-out**: The task description (T1218 §Implementation Notes) says "retain hyphens and alphanumerics" — confirmed. Direct tests (2026-04-14, `github-slugger@2.0.0`, Node 24.11):
- `slug("a-b")` → `"a-b"` (hyphen preserved)
- `slug("a_b")` → `"a_b"` (underscore preserved)
- `slug("a.b")` → `"ab"` (period stripped)
- `slug("a!b")` → `"ab"` (bang stripped)
- `slug("a/b")` → `"ab"` (slash stripped)
- `slug("Café")` → `"café"` (accent preserved)

This matches the CLAUDE.md §Coding Standards convention where underscore-separated DB columns like `location_key` slug to `location_key-strategy` (see §8 test vectors).

**Empirical behaviors to document** (verified against `github-slugger@2.0.0` on 2026-04-14):

| Input | Output | Notes |
|-------|--------|-------|
| `"Rule 0: The Isolation Hierarchy (SUPREME RULE)"` | `"rule-0-the-isolation-hierarchy-supreme-rule"` | Canonical test case from task file |
| `"Rule 2: Three-Tier Authentication (NON-NEGOTIABLE)"` | `"rule-2-three-tier-authentication-non-negotiable"` | Multi-word + parens + hyphenated term |
| `"BLOCKERS — MUST FIX BEFORE PILOT [0]"` | `"blockers--must-fix-before-pilot-0"` | Em-dash → double hyphen (whitespace-surrounded em-dash strips, leaving `  ` which converts to `--`) |
| `"4.1 drift-gate (REUSE)"` | `"41-drift-gate-reuse"` | Periods strip, digits glue together |
| `` "7. `location_key` Strategy" `` | `"7-location_key-strategy"` | Backticks strip; underscore preserved |
| `"H1. Consent missing before analytics load"` | `"h1-consent-missing-before-analytics-load"` | Rubric heading convention |
| `"/verify-claims post-pass detail"` | `"verify-claims-post-pass-detail"` | Leading slash strips |
| `"Café"` | `"café"` | Accented characters PRESERVED |
| `"__bold__"` | `"__bold__"` | Underscores preserved; markdown emphasis NOT stripped |
| `"**Strong** heading"` | `"strong-heading"` | Asterisks strip |

**Deviation from task description**: The T1218 task file's Implementation Notes say parenthesis handling is `(NON-NEGOTIABLE)` → `-non-negotiable-` with "hyphens adjacent to parens collapse to single hyphen." Empirically, github-slugger strips `(` and `)` as punctuation, converts surrounding spaces to hyphens, but does NOT collapse consecutive hyphens. For the specific input `"Rule 2: Three-Tier Authentication (NON-NEGOTIABLE)"` the output is `"rule-2-three-tier-authentication-non-negotiable"` (single hyphens throughout) because the source pattern is `...Authentication (NON-NEGOTIABLE)` — one space before `(`, and the trailing `)` is the last character. So the empirical output MATCHES the task's expected output `rule-2-three-tier-authentication-non-negotiable`, even though the reasoning the task gives (about hyphen collapse) is not what github-slugger actually does. Consecutive hyphens occur when consecutive punctuation chars separate tokens (e.g. em-dash surrounded by spaces → `--`). Document and proceed.

### 3.4 `closestSlug(anchor, allSlugs)` — fuzzy suggestion

When an anchor does not resolve, attach the closest-matching slug from the file as a hint so the reviewer can correct future findings. This is a quality-of-life annotation, NOT a severity-affecting decision — the finding gets demoted regardless of whether a suggestion is found.

```
function closestSlug(anchor: string, allSlugs: string[]) → string | null:
    best = null
    bestScore = 0.5                                    // require at least 50% similarity
    for s in allSlugs:
        score = tokenOverlap(anchor, s)
        if score > bestScore:
            best = s
            bestScore = score
    return best
```

Simple token-overlap metric:
```
function tokenOverlap(a: string, b: string) → number:
    aTokens = new Set(a.split("-"))
    bTokens = new Set(b.split("-"))
    intersection = aTokens.intersection(bTokens).size
    union = aTokens.union(bTokens).size
    return union > 0 ? intersection / union : 0
```

Jaccard similarity on hyphen-delimited tokens. Keep it cheap — this runs per broken finding, so N×M where N = broken findings and M = headings in the target file. Worst-case N ≈ 50, M ≈ 100 → 5000 ops per run, negligible.

Phase-2 improvement candidate: use Levenshtein distance for anchors that differ by typos rather than by word-set (e.g. `#rule-zero-...` vs. `#rule-0-...`). Not worth the extra code in Phase 1.

## 4. Demotion and annotation

### 4.1 `demote(finding)` — one-tier demotion per §6

```
function demote(f: Finding):
    rank = { P0: 0, P1: 1, P2: 2, P3: 3 }
    inverse = { 0: "P0", 1: "P1", 2: "P2", 3: "P3" }
    current = rank[f.severity]
    f.severity = inverse[min(3, current + 1)]          // P3 is the floor
```

Matches `severityMax` ordering in `halli-workflows:types/finding.md` §Severity. A finding already at P3 stays at P3 (can't demote below floor).

### 4.2 `annotate(finding, note)` — append to evidence

```
function annotate(f: Finding, note: string):
    f.evidence = f.evidence + " | " + note
```

Uses the same ` | ` separator used by dedup's evidence merging (§8 of design doc, implemented in T1216 module). Preserves the original evidence so the reviewer's claim is still readable; appends the validator's note so the dashboard shows BOTH.

### 4.3 File-missing: hard-demote to P3

Per T1218 acceptance criterion: "If target file does not exist: demote to P3 + annotate `rule_link_file_missing`." This is a stronger signal than a broken anchor (the rubric author didn't just typo — the file they referenced is entirely absent), so it jumps straight to P3 rather than one-tier demotion. A P0 finding with a missing target file becomes P3, not P1.

## 5. Exemptions (§6 hard-coded ceiling)

The following findings are NEVER demoted by this validator. They either OWN the rubric integrity signal (drift-gate, rubric-check) or represent orchestrator-level fail-loud gates that must stay at P0.

```
function isExempt(f: Finding) → boolean:
    if f.agent == "drift-gate":
        return true                                    // §6: drift-gate is always P0
    if f.heuristic_id == "RUBRIC_MISSING":
        return true                                    // §6: orchestrator RUBRIC_MISSING is always P0
    if targetIsRubricFile(f.rule_link) and rubricCheckModuleOwnsIt(f.rule_link):
        return true                                    // rubric-check module already validated presence
    return false
```

When an exempt finding has a broken rule_link:
- Do NOT demote.
- Emit a `stderr` warning: `[anchor-validator] WARN: exempt finding has broken rule_link: {finding.agent} {finding.heuristic_id} -> {finding.rule_link}`. This surfaces rubric drift in the halli-workflows plugin itself (our anchors should match our docs; if they don't, someone edited a heading without updating callers).

**Rubric-path exemption detail**: If `rule_link` points to a file under `docs/review-rubrics/` or `docs/ux-rubrics/`, and the rubric-check module (T1215) already validated that the file exists at run-start, trust that decision — the rubric-check module emits a `RUBRIC_MISSING` finding if the file is absent, which is itself exempt. The anchor-within-the-rubric CAN still break, though, so we still validate the anchor; we just don't re-validate file existence.

## 6. Self-uncertainty surfacing

Per Rule 13: if this module is unsure about slug edge cases, surface the uncertainty as a P3 finding rather than silently passing the finding through as valid.

Cases where the validator emits an ADDITIONAL P3 finding tagged `anchor_validator_uncertain` (with `agent: "orchestrator"`) alongside the demoted original:

1. Heading contains HTML (e.g. `## Foo <span>bar</span>`). The slugger may strip HTML tags via the regex, but real GitHub parses HTML via its markdown pipeline first. Uncertain behavior → flag.
2. Heading contains an inline link with non-trivial display text (e.g. `## See [the Rule 13 section](#rule-13) details`). Brackets strip but the href does not — the slug is computed on the raw text `See the Rule 13 section details` not on `See Rule 13`. Real GitHub behavior may differ.
3. Heading contains a reference-style link or a footnote (`## Foo[^1]`). Brackets strip; caret likely strips; digit remains; behavior unverified.
4. File contains setext-style headings (`Heading\n=======` or `Heading\n-------`). Phase 1 does not extract these; if the file is ALL setext (none of our actual files are), every rule_link targeting it would spuriously demote.
5. File is outside the monorepo root (e.g. `../../other-project/CLAUDE.md`). The validator resolves relative to the provided `repoRoot`; out-of-tree paths may trigger file-read errors.

The additional P3 finding looks like:

```json
{
  "agent": "orchestrator",
  "severity": "P3",
  "rule_link": "halli-workflows:commands/pilot-review/anchor-validator.md#6-self-uncertainty-surfacing",
  "verdict": "uncertain",
  "evidence": "Anchor validation uncertain for original finding {original.location_key} — heading contains HTML/link/footnote the slug algorithm may mishandle.",
  "location_key": "meta:anchor-validator:uncertain:{original.location_key}",
  "heuristic_id": "anchor_validator_uncertain",
  "suggested_fix": "Manually verify the target heading renders to the expected anchor on GitHub. If it does, file a Phase-2 ticket to upgrade the slugger algorithm.",
  "screenshot": null,
  "witnesses": ["orchestrator"]
}
```

Keep these rare — emit at most one uncertainty finding per original finding, capped at 10 per run (above that, it's a rubric-authoring problem and spamming the dashboard helps nobody).

## 7. Caching

File reads are cached by absolute path for the duration of one `validateRuleLinks` invocation. The cache key is the absolute path; the value is either `FILE_MISSING` (sentinel) or the `HeadingIndex`. This ensures each file is opened and parsed once per run even if every finding in the input references the same file.

Cache is NOT persisted across runs. Each orchestrator invocation builds a fresh cache.

## 8. Test vectors (authoritative)

Verified empirically against `github-slugger@2.0.0` on the GuestPad cabin repo, 2026-04-14.

### 8.1 Positive cases (anchor resolves)

| Target heading in CLAUDE.md | Computed slug | rule_link that resolves |
|-----------------------------|---------------|-------------------------|
| `## Rule 0: The Isolation Hierarchy (SUPREME RULE)` | `rule-0-the-isolation-hierarchy-supreme-rule` | `CLAUDE.md#rule-0-the-isolation-hierarchy-supreme-rule` |
| `### Rule 2: Three-Tier Authentication (NON-NEGOTIABLE)` | `rule-2-three-tier-authentication-non-negotiable` | `CLAUDE.md#rule-2-three-tier-authentication-non-negotiable` |
| `### Rule 11: Realtime Payload Conversion (NON-NEGOTIABLE)` | `rule-11-realtime-payload-conversion-non-negotiable` | `CLAUDE.md#rule-11-realtime-payload-conversion-non-negotiable` |
| `### Rule 12: Live Dashboard Badges (NON-NEGOTIABLE)` | `rule-12-live-dashboard-badges-non-negotiable` | `CLAUDE.md#rule-12-live-dashboard-badges-non-negotiable` |
| `### Rule 13: Intellectual Honesty — No Hallucinated Solutions (NON-NEGOTIABLE)` | `rule-13-intellectual-honesty--no-hallucinated-solutions-non-negotiable` (note **double hyphen**) | `CLAUDE.md#rule-13-intellectual-honesty--no-hallucinated-solutions-non-negotiable` |

**Critical calibration finding**: Test case 5 above is non-obvious. The Rule 13 heading contains an em-dash (U+2014) surrounded by spaces (`Honesty — No`). github-slugger strips the em-dash while leaving both flanking spaces, and both spaces then convert to hyphens → two adjacent hyphens in the slug. The CORRECT slug is `rule-13-intellectual-honesty--no-hallucinated-solutions-non-negotiable` (note the `--` between `honesty` and `no`).

This is load-bearing: if any agent emits `rule_link: "CLAUDE.md#rule-13-intellectual-honesty-no-hallucinated-solutions-non-negotiable"` (single hyphen, the "natural" guess), the validator will correctly flag it as broken and suggest the true slug via fuzzy match. Agents whose prompts reference Rule 13 MUST use the double-hyphen form — verified already in `halli-workflows:agents/codebase-auditor-adapter.md` lines 85-103 and `docs/plans/tasks/T1208-agent-codebase-auditor-adapter.md` line 72.

The same double-hyphen pattern affects any heading with em-dash-surrounded-by-spaces. Recommended audit during rubric authoring: `grep -E '^#{1,6}\s+.*[[:space:]]—[[:space:]]' CLAUDE.md` (and equivalents on rubric files).

### 8.2 Negative cases (broken anchor)

| rule_link | Expected outcome |
|-----------|-----------------|
| `CLAUDE.md#nonexistent-heading` | Demote one tier, annotate `rule_link_broken: CLAUDE.md#nonexistent-heading`; no suggestion (no fuzzy match) |
| `CLAUDE.md#rule-99-foo-bar` | Demote one tier, annotate `rule_link_broken: CLAUDE.md#rule-99-foo-bar` |
| `CLAUDE.md#rule-0-the-isolaton-hierarchy` (typo) | Demote one tier, suggest `#rule-0-the-isolation-hierarchy-supreme-rule` (Jaccard ≈ 0.67) |

### 8.3 Missing-file cases

| rule_link | Expected outcome |
|-----------|-----------------|
| `docs/fake.md#foo` | Demote to P3 (not one-tier), annotate `rule_link_file_missing: docs/fake.md` |
| `docs/review-rubrics/privacy-gdpr.md#h1-consent` where file deleted mid-run | Skip (rubric-check module already emitted RUBRIC_MISSING) |

### 8.4 Exemption cases

| Finding | Rule_link | Expected outcome |
|---------|-----------|-----------------|
| `agent: drift-gate`, severity P0 | broken anchor | **No demotion** — warn on stderr; stays P0 |
| `heuristic_id: RUBRIC_MISSING`, severity P0 | broken anchor | **No demotion** — warn; stays P0 |

### 8.5 Malformed rule_link

| rule_link | Expected outcome |
|-----------|-----------------|
| `""` (empty) | Caught by finding schema validation before reaching this module; not our problem |
| `"#foo"` (anchor only, no path) | Annotate `rule_link_malformed`, demote one tier |
| `"https://stripe.com/docs/webhooks"` | Skip (external URL, §4 Non-Goals of the task) |
| `"path#one#two"` | Split at first `#`; anchor = `"one#two"`; will fail to resolve; demote (don't crash) |

## 9. Wiring into the orchestrator

Per Design Doc §12 step 8e, the orchestrator calls this module AFTER dedup (step 8c) and /verify-claims (step 8d), BEFORE the final severity sort (step 8f) and before the dashboard write (step 9).

Pseudocode fragment for `pilot-review-orchestrator`:

```
grouped       = groupByLocationKey(rawFindings)
merged        = grouped.map(mergeGroup)                     // T1216 module
verified      = await runGroundTruthVerifier(merged)        // T1217 module
anchorChecked = validateRuleLinks(verified, repoRoot)       // THIS module
sorted        = anchorChecked.sort(severityThenWitnessCount)
```

The orchestrator at scaffold stage (T1201) has an empty roster and therefore zero findings — validateRuleLinks short-circuits correctly on empty input (returns `[]`).

## 10. Rule 13 compliance declaration

- Slug algorithm source: `github-slugger@2.0.0` (MIT license, Dan Flettre + Titus Wormer). The exact Unicode regex is in `node_modules/github-slugger/regex.js` of that package. Verified empirically against our CLAUDE.md, design doc, and representative rubric headings. See §8 test vectors for the calibration runs.
- Deviation from T1218 task description acknowledged: the task's claim that `(NON-NEGOTIABLE)` yields `-non-negotiable-` via "hyphen collapse" is inaccurate as stated; github-slugger strips the parens and converts surrounding spaces to single hyphens (no collapse needed for this case because there IS no consecutive punctuation). Em-dash-surrounded-by-spaces IS a real source of double hyphens. Documented in §3.3 and §8.1.
- Edge cases surfaced as uncertainty (§6): HTML in headings, inline links with non-trivial text, setext headings, footnotes, out-of-tree paths. Each produces a P3 `anchor_validator_uncertain` finding rather than silent pass/fail.
- No hallucinated interfaces: the Read/Grep/Glob tool surface is real; the `halli-workflows:types/finding.md` contract is real (link verified 2026-04-14); the Design Doc §5/§6/§12 references are real (line counts verified 2026-04-14).
- No fabricated data: this module returns findings transformed only through the documented algorithm. No dummy values, no hardcoded outputs, no "looks correct" short-circuits.

## 11. Completion criteria (matches task T1218)

- [x] Pure function `validateRuleLinks(findings, repoRoot)` specified — reads target files, returns mutated findings, same length
- [x] Parses `rule_link` as `path#anchor` or bare `path` (anchor optional)
- [x] Heading-slug generator references github-slugger v2.0.0 (Design Doc §5 rules satisfied; calibration tests in §8)
- [x] Parenthetical suffixes retained as part of the slug (parens strip; the token text survives as `non-negotiable`; preceding/trailing space becomes a hyphen)
- [x] Canonical test case `rule-0-the-isolation-hierarchy-supreme-rule` resolves (verified empirically)
- [x] Broken anchor → one-tier demote + annotate
- [x] Missing file → P3 demote + annotate
- [x] Drift-gate and RUBRIC_MISSING exempt (warn on stderr, stay P0)
- [x] Rubric-file findings: defer file existence to rubric-check module; still validate anchor
- [x] File reads cached per run (one read per unique path)
- [x] Uncertainty cases surfaced as P3 `anchor_validator_uncertain` findings

## 12. References

- Design Doc: `docs/design/pilot-review-system-design.md` in consuming project (cabin)
  - §5 Finding Schema (rule_link format)
  - §6 Severity Taxonomy and Escalation (one-tier demotion rule; hard-coded ceiling)
  - §12 Orchestration Flow (step 8e placement)
- Canonical Finding schema: `halli-workflows:types/finding.md`
- Slug algorithm: https://github.com/Flet/github-slugger (v2.0.0, MIT)
- Related modules in the same pipeline:
  - `halli-workflows:commands/pilot-review/dedup.md` (T1216 — dedup by location_key; NOT YET AUTHORED)
  - `halli-workflows:commands/pilot-review/verify-claims.md` (T1217 — /verify-claims wrapper; NOT YET AUTHORED)
  - `halli-workflows:commands/pilot-review/rubric-check.md` (T1215 — rubric existence gate; NOT YET AUTHORED)
  - `halli-workflows:commands/pilot-review/dashboard.md` (T1219 — consumer of this module's output; NOT YET AUTHORED)
- Task file: `docs/plans/tasks/T1218-orchestrator-rule-link-validator.md` in consuming project

## 13. Change log

| Plugin version | Change |
|----------------|--------|
| (unreleased) | Initial authoring (T1218). Module specification only; no plugin version bump yet (plugin.json unchanged per T1218 cross-repo instructions). Version bump happens when the orchestrator pipeline modules land together per the Phase 1.4 task sequence. |

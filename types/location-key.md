# location_key — Grammar and Helpers

> The `location_key` field on every Finding is the idempotency linchpin of the pilot-review
> system. Same location → same key across runs → orchestrator merges witnesses instead of
> filing duplicate eljun tasks. Derived from `docs/design/pilot-review-system-design.md` §7.

## Design principle

**No line numbers.** Line numbers change every time a file is edited above the finding;
using them would cause every patch to generate "new" findings and defeat dedup. Use
**symbol names** (function names, class names, export names, policy names, route segments)
instead of positions whenever possible.

## Format per finding type

Six variants. Each has a fixed prefix and a fixed number of colon-separated segments.

```
code        : code:{repo_relative_path}:{symbol_name}:{heuristic_id}
db          : db:{table_name}:{column_or_policy_name}:{rule_id}
dep         : dep:{package_name}:{cve_or_advisory_id}
ux          : ux:{flow_id}:{step_id}:{heuristic_id}
mon         : mon:{service_or_subsystem}:{gap_id}
rubric-gap  : rubric-gap:{rubric_path}:{missing_section}
```

## Helper contract

The orchestrator implements a `locationKey` namespace with one pure function per type.
All inputs are strings. Helpers MUST:

- normalize file paths to forward slashes
- reject (or strip) absolute paths so the key never leaks `/home/halli/...`
- reject inputs containing line-number patterns (`:12:`, `:123`, etc.)
- NOT accept a `lineNumber` parameter — the type signature must make line numbers impossible

Reference TypeScript signatures (for the orchestrator's implementation):

```ts
export const locationKey = {
  code(path: string, symbol: string, heuristicId: string): string;
  db(table: string, policyOrColumn: string, ruleId: string): string;
  dep(pkg: string, advisoryId: string): string;
  ux(flowId: string, stepId: string, heuristicId: string): string;
  mon(service: string, gapId: string): string;
  rubricGap(path: string, missingSection: string): string;
};
```

Note: no function in the namespace accepts a numeric parameter. Line numbers are
**structurally impossible** at the type level, not merely discouraged.

## Per-type details

### 1. `code`

For findings in source code (functions, handlers, hooks, components, modules).

**Format**: `code:{path}:{symbol}:{heuristic_id}`

- `path` — repo-relative, forward slashes, no leading `/`. Examples:
  `apps/guestpad/src/app/api/messages/route.ts`,
  `packages/aurora-engine/src/scoring.ts`.
- `symbol` — the smallest named thing at this location. Prefer:
  - Exported HTTP handler name (`POST`, `GET`, `DELETE`)
  - Exported function name (`calculateScore`, `validateInput`)
  - Class or component name (`DashboardShell`, `UseAuth`)
  - For module-level issues with no enclosing symbol, use `<module>`.
- `heuristic_id` — the agent rubric's heuristic ID (e.g. `auth.getUser_missing`,
  `iso.cross_property_query`).

**Examples**:

```
code:apps/guestpad/src/app/api/messages/route.ts:POST:auth.getUser_missing
code:apps/guestpad/src/app/api/messages/route.ts:POST:auth.zod_missing
code:packages/aurora-engine/src/scoring.ts:calculateScore:pay.float_currency
code:apps/guestpad/src/lib/supabase/service.ts:<module>:auth.service_client_misuse
```

**Reference implementation**:

```ts
function code(path: string, symbol: string, heuristicId: string): string {
  const normalized = normalizeRepoPath(path); // see §stability helpers
  assertNoLineNumber(symbol);
  assertNoLineNumber(heuristicId);
  return `code:${normalized}:${symbol}:${heuristicId}`;
}
```

### 2. `db`

For findings about database tables, RLS policies, columns, indexes, migrations.

**Format**: `db:{table}:{column_or_policy}:{rule_id}`

- `table` — canonical table name, unquoted, snake_case (PostgreSQL convention).
- `column_or_policy` — column name, policy name, or constraint name. For findings about
  a whole table (e.g. missing RLS), use a descriptive slug: `rls_missing`, `rls_declaration_missing`.
- `rule_id` — rubric heuristic ID. Often `iso.rls.missing`, `iso.rls.declaration_missing`, `drift`.

**Examples**:

```
db:bar:rls_missing
db:ai_usage_log:property_isolation:iso.rls.missing
db:tablets:tablet_id:iso.rls.declaration_missing
db:messages:property_isolation:iso.rls.missing
```

Note: the design doc shows BOTH 3-segment (`db:bar:rls_missing`) and 4-segment
(`db:ai_usage_log:property_isolation:iso.rls.missing`) forms in its examples. The
4-segment form is canonical when a specific policy or column is implicated. The
3-segment form is a shorthand accepted when the rule_id already encodes enough detail
(e.g. `rls_missing` — there is only one way a table can lack RLS). Reviewers SHOULD
emit the 4-segment form for clarity.

**Reference implementation**:

```ts
function db(table: string, policyOrColumn: string, ruleId: string): string {
  assertNoLineNumber(table);
  assertNoLineNumber(policyOrColumn);
  assertNoLineNumber(ruleId);
  return `db:${table}:${policyOrColumn}:${ruleId}`;
}
```

### 3. `dep`

For findings about dependencies (CVEs, deprecated packages, major-version-behind).

**Format**: `dep:{package}:{advisory_id}`

- `package` — the exact npm/PyPI/crates.io package name. For scoped npm packages,
  keep the scope (`@supabase/ssr`).
- `advisory_id` — the upstream advisory identifier (GHSA, CVE, Snyk, deps.dev). If
  no public ID exists (e.g. "package is abandoned"), use a canonical slug:
  `unmaintained`, `deprecated`, `major_version_behind`.

**Examples**:

```
dep:axios:GHSA-xxxx-yyyy-zzzz
dep:@supabase/ssr:CVE-2024-12345
dep:moment:deprecated
dep:react:major_version_behind
```

**Reference implementation**:

```ts
function dep(pkg: string, advisoryId: string): string {
  assertNoLineNumber(pkg);
  assertNoLineNumber(advisoryId);
  return `dep:${pkg}:${advisoryId}`;
}
```

### 4. `ux` (Phase 2)

For UX reviewer findings. **Not used in Phase 1** — contract specified now so Phase 2
reviewers conform when they ship.

**Format**: `ux:{flow_id}:{step_id}:{heuristic_id}`

- `flow_id` — the user flow being audited, kebab-case (`find-wifi-password`,
  `request-extra-towels`, `owner-first-login`).
- `step_id` — the step within the flow, kebab-case with ordinal prefix
  (`step-1-open-app`, `step-2-tap-connect`, `step-3-enter-password`).
- `heuristic_id` — the rubric heuristic (`touch-target-too-small`,
  `cognitive-load-exceeded`, `icon-without-label`).

**Examples**:

```
ux:find-wifi-password:step-2-tap-connect:touch-target-too-small
ux:owner-first-login:step-1-signup:cognitive-load-exceeded
ux:request-extra-towels:step-3-confirm:icon-without-label
```

**Reference implementation**:

```ts
function ux(flowId: string, stepId: string, heuristicId: string): string {
  assertNoLineNumber(flowId);
  assertNoLineNumber(stepId);
  assertNoLineNumber(heuristicId);
  return `ux:${flowId}:${stepId}:${heuristicId}`;
}
```

### 5. `mon`

For monitoring / observability gaps. Fewer segments — monitoring gaps are scoped to a
service rather than a specific line.

**Format**: `mon:{service}:{gap_id}`

- `service` — the service or subsystem name (`aurora-api`, `guestpad`,
  `aurora-hunter`, `stripe-webhook`, `eljun`).
- `gap_id` — the monitoring-rubric heuristic ID (`sentry_absent`, `pii_scrub_absent`,
  `critical_path_uninstrumented`, `uptime_absent`, `structured_logging_absent`,
  `alert_noise`).

**Examples**:

```
mon:aurora-api:sentry_absent
mon:guestpad:pii_scrub_absent
mon:stripe-webhook:critical_path_uninstrumented
mon:aurora-hunter:uptime_absent
```

**Reference implementation**:

```ts
function mon(service: string, gapId: string): string {
  assertNoLineNumber(service);
  assertNoLineNumber(gapId);
  return `mon:${service}:${gapId}`;
}
```

### 6. `rubric-gap`

Emitted by the **orchestrator** (not a reviewer) when a required rubric file is missing
or unfilled. See design §9 fail-loud protocol.

**Format**: `rubric-gap:{rubric_path}:{missing_section}`

- `rubric_path` — repo-relative path to the rubric file, forward slashes.
- `missing_section` — what is missing. Canonical values: `file_missing`,
  `stub_unfilled`, `below_minimum_heuristic_coverage`.

**Examples**:

```
rubric-gap:docs/review-rubrics/privacy-gdpr.md:file_missing
rubric-gap:docs/review-rubrics/payment.md:stub_unfilled
rubric-gap:docs/ux-rubrics/guest-tablet.md:below_minimum_heuristic_coverage
```

**Reference implementation**:

```ts
function rubricGap(path: string, missingSection: string): string {
  const normalized = normalizeRepoPath(path);
  assertNoLineNumber(missingSection);
  return `rubric-gap:${normalized}:${missingSection}`;
}
```

## Stability rules (design §7, lines 683–690)

1. **No line numbers.** If the file is rearranged, the key must still match.
2. **Symbol names over positions.** `POST` is stable; "line 23" is not.
3. **Heuristic ID required.** Two different problems on the same symbol get different keys.
4. **File paths repo-relative**, always forward slashes, no absolute paths.
5. **Table/column names canonical**, not quoted (`bar`, not `"bar"`).
6. **Rubric-version-aware (audit only in Phase 1).** When a rubric file changes, the
   `rubric_hash` changes. Phase 1 dedup matches by `preflight_hash` only; Phase 2 will
   use `rubric_hash` for superseding.

## Stability helpers

These support functions back the main `locationKey` namespace. They are pure — no I/O,
deterministic, stateless. The orchestrator implements them.

### `normalizeRepoPath(path: string): string`

- Rejects absolute paths (throws on strings starting with `/` or `~` or Windows drive letters).
- Converts backslashes to forward slashes.
- Collapses `./` prefixes.
- Does NOT resolve symlinks or follow paths on disk — this is a string operation only.

```ts
function normalizeRepoPath(path: string): string {
  if (path.startsWith("/") || path.startsWith("~") || /^[A-Za-z]:[\\/]/.test(path)) {
    throw new Error(`Absolute path in location_key: ${path}. Use repo-relative.`);
  }
  const forwardSlashed = path.replace(/\\/g, "/");
  const noLeadingDot = forwardSlashed.startsWith("./")
    ? forwardSlashed.slice(2)
    : forwardSlashed;
  // Reject line-number suffixes in the path itself (path:12, path:12:34).
  // Symbol names and heuristic IDs never contain colons, so any colon here is suspect.
  if (noLeadingDot.includes(":")) {
    throw new Error(`Colon in path segment: ${path}. Likely a line-number reference; strip it before building location_key.`);
  }
  return noLeadingDot;
}
```

### `assertNoLineNumber(segment: string): void`

- Throws if the segment contains a pattern that looks like a line number reference.
- Heuristic: colon followed by digits, optionally followed by colon (`:12`, `:12:`).
  Reviewers should never pass such segments — symbols like `POST`, `calculateScore`,
  `rls_missing` never contain colons.

```ts
function assertNoLineNumber(segment: string): void {
  if (/:[0-9]+(:|$)/.test(segment)) {
    throw new Error(`Line number detected in location_key segment: ${segment}. Forbidden per §7.`);
  }
}
```

## Common mistakes to avoid

| Wrong | Right |
|-------|-------|
| `code:apps/guestpad/src/app/api/messages/route.ts:23:auth_missing` | `code:apps/guestpad/src/app/api/messages/route.ts:POST:auth.getUser_missing` |
| `code:/home/halli/cabin/apps/guestpad/src/app/api/messages/route.ts:POST:auth` | `code:apps/guestpad/src/app/api/messages/route.ts:POST:auth.getUser_missing` |
| `code:apps\\guestpad\\src\\app\\api\\messages\\route.ts:POST:auth` | `code:apps/guestpad/src/app/api/messages/route.ts:POST:auth.getUser_missing` |
| `db:"bar":rls_missing` | `db:bar:rls_missing` |
| `db:bar:rls_missing:iso.rls.missing:extra` (5 segments) | `db:bar:property_isolation:iso.rls.missing` (4 segments) |
| `mon:aurora-api:sentry_absent:extra:noise` | `mon:aurora-api:sentry_absent` |

## Testing this grammar

The orchestrator SHOULD include unit tests of the form:

- `locationKey.code("apps/x/y.ts", "POST", "auth.getUser_missing")` → `"code:apps/x/y.ts:POST:auth.getUser_missing"`
- `locationKey.code("/home/halli/x.ts", "POST", "auth")` → throws (absolute path)
- `locationKey.code("apps/x.ts:12", "POST", "auth")` → throws (line number in path)
- `locationKey.db("ai_usage_log", "property_isolation", "iso.rls.missing")` → `"db:ai_usage_log:property_isolation:iso.rls.missing"`
- `locationKey.dep("axios", "GHSA-xxxx-yyyy-zzzz")` → `"dep:axios:GHSA-xxxx-yyyy-zzzz"`
- `locationKey.ux("find-wifi-password", "step-2-tap-connect", "touch-target-too-small")` → `"ux:find-wifi-password:step-2-tap-connect:touch-target-too-small"`
- `locationKey.mon("aurora-api", "sentry_absent")` → `"mon:aurora-api:sentry_absent"`
- `locationKey.rubricGap("docs/review-rubrics/privacy-gdpr.md", "file_missing")` → `"rubric-gap:docs/review-rubrics/privacy-gdpr.md:file_missing"`

Round-trip test vectors match the canonical examples in the design doc §7 Examples block
(lines 663–681).

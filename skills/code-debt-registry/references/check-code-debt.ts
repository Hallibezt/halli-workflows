#!/usr/bin/env tsx
/**
 * Code-debt registry enforcer — CLAUDE.md Rule 15.
 *
 * Every TODO / FIXME / XXX / HACK / hopeful-phrase comment in source code
 * MUST be registered in `docs/code-debt-registry.md` and referenced in-code
 * by a `TD-XXXX` identifier (e.g., `// TODO(TD-0001): description`).
 *
 * Why this exists:
 *   "Hopeful comments" are an agentic anti-pattern: agents (and humans)
 *   write `// TODO`, `// known limitation`, `// not yet implemented` as a
 *   substitute for tracking. Without enforcement these comments accumulate,
 *   create false confidence ("at least it's documented"), and rot silently
 *   as the codebase evolves. The reset-and-unlink bug shipped 2026-05-10 is
 *   exhibit A: the JWT-revoked gap was commented in the route header, not
 *   tracked anywhere, never resolved.
 *
 *   This scanner closes the loop: any deferred-work language in code without
 *   a corresponding registry entry blocks commit + push + CI.
 *
 * Modes (first positional arg):
 *   --check (default) — scan source files, report violations, exit 1 on any
 *   --list            — print open debt grouped by severity
 *   --add             — interactive prompt to create a new TD-XXXX entry
 *   --json            — same as --check but JSON output (for CI integrations)
 *
 * Exit codes:
 *   0 — clean (no violations)
 *   1 — violations found
 *   2 — CLI usage error
 *
 * Bypass (emergencies only, document in commit message):
 *   git commit --no-verify       # bypasses ALL hooks
 *
 * Inline suppression:
 *   // debt:ignore                — suppresses checks on the same line
 *   // debt:ignore-next-line      — suppresses checks on the following line
 *
 * Reserved for the registry author / tooling. Use sparingly.
 */

import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, relative } from "node:path";
import { createInterface } from "node:readline";

const REPO_ROOT = process.cwd();
const REGISTRY_PATH = join(REPO_ROOT, "docs", "code-debt-registry.md");

const SOURCE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".sql"];

const EXCLUDED_DIRS = new Set([
  "node_modules",
  ".next",
  ".vercel",
  "dist",
  "build",
  "out",
  "coverage",
  ".git",
  ".claude",
  "tests-output",
]);

const EXCLUDED_PATHS = [
  "scripts/check-code-debt.ts", // self-reference
  "src/generated/", // auto-generated Prisma client
];

const COLORS = {
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  green: "\x1b[32m",
  cyan: "\x1b[36m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
  reset: "\x1b[0m",
};

// ---------------------------------------------------------------------------
// Pattern catalog
// ---------------------------------------------------------------------------

interface Pattern {
  re: RegExp;
  name: string;
  category: "todo" | "jsdoc" | "hopeful";
}

const DEBT_PATTERNS: Pattern[] = [
  // Classic markers — uppercase + colon/paren required (no space between).
  //
  // The strict marker-and-punctuation form distinguishes real markers from
  // user-facing text, test descriptions, and URL placeholders:
  //   ✓ matches:  // TODO: thing      // TODO(TD-0001): thing
  //   ✗ skips:    "Add a TODO list"   ?propertyId=XXX (URL placeholder)
  //               bug: { ... } (object key — lowercase, not the marker)
  //               XXX-XXX (3 uppercase letters) (provision-code regex example)
  { re: /\bTODO[:(]/, name: "TODO marker", category: "todo" },
  { re: /\bFIXME[:(]/, name: "FIXME marker", category: "todo" },
  { re: /\bXXX:/, name: "XXX marker", category: "todo" },
  { re: /\bHACK[:(]/, name: "HACK marker", category: "todo" },
  { re: /\bBUG:/, name: "BUG: marker", category: "todo" },

  // JSDoc tags that promise future work
  { re: /@todo\b/i, name: "@todo tag", category: "jsdoc" },
  { re: /@deprecated\b/i, name: "@deprecated tag", category: "jsdoc" },

  // Hopeful phrases — softer language that promises but doesn't track.
  // "in the future" is constrained with a negative lookbehind so it skips
  // state-describing usage ("is/are/was in the future") common in test names
  // and explanatory comments, while still catching promise-language.
  { re: /known limitation/i, name: 'phrase: "known limitation"', category: "hopeful" },
  { re: /known issue/i, name: 'phrase: "known issue"', category: "hopeful" },
  { re: /not yet implemented/i, name: 'phrase: "not yet implemented"', category: "hopeful" },
  { re: /\bnot implemented\b/i, name: 'phrase: "not implemented"', category: "hopeful" },
  {
    re: /(?<!\b(?:is|are|was|were|be|been|being|stay|stays|stayed|staying|remain|remains|remained|remaining|fall|falls|fell|falling|land|lands|landed|landing|sit|sits|sat|sitting|happen|happens|happened|happening|enough)\s)in the future/i,
    name: 'phrase: "in the future"',
    category: "hopeful",
  },
  { re: /future work/i, name: 'phrase: "future work"', category: "hopeful" },
  { re: /will need to/i, name: 'phrase: "will need to"', category: "hopeful" },

  // Deferred-action verb patterns — narrowed to specific verbs to avoid
  // mathematical assertions ("x should be > 0") and similar false positives.
  {
    re: /should be (refactored|removed|cleaned|moved|implemented|added|handled|fixed|done|wired|migrated|dropped|deleted|reviewed|consolidated|simplified|verified)/i,
    name: "phrase: should be <deferred-verb>",
    category: "hopeful",
  },
  {
    re: /needs to be (refactored|removed|cleaned|moved|implemented|added|handled|fixed|done|wired|migrated|dropped|deleted|reviewed|consolidated|simplified|verified)/i,
    name: "phrase: needs to be <deferred-verb>",
    category: "hopeful",
  },
  {
    re: /has to be (refactored|removed|cleaned|moved|implemented|added|handled|fixed|done|wired|migrated|dropped|deleted|reviewed|consolidated|simplified|verified)/i,
    name: "phrase: has to be <deferred-verb>",
    category: "hopeful",
  },
];

const TD_ID_PATTERN = /\bTD-\d{4,}\b/g;
const IGNORE_SAME_LINE = /\/\/\s*debt:\s*ignore\b(?!-next-line)/i;
const IGNORE_NEXT_LINE = /\/\/\s*debt:\s*ignore-next-line\b/i;

// ---------------------------------------------------------------------------
// File walking
// ---------------------------------------------------------------------------

function walkSourceFiles(): string[] {
  const out: string[] = [];
  walk(REPO_ROOT, out);
  return out.sort();
}

function walk(dir: string, out: string[]): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (EXCLUDED_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    let s;
    try {
      s = statSync(full);
    } catch {
      continue;
    }
    if (s.isDirectory()) {
      walk(full, out);
    } else if (s.isFile()) {
      const rel = relative(REPO_ROOT, full);
      if (EXCLUDED_PATHS.some((p) => rel.startsWith(p))) continue;
      if (SOURCE_EXTENSIONS.some((ext) => rel.endsWith(ext))) {
        out.push(rel);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Scanning
// ---------------------------------------------------------------------------

interface Finding {
  file: string;
  line: number;
  pattern: string;
  category: Pattern["category"];
  text: string;
  hasTdId: boolean;
  tdIds: string[];
}

function scanFile(rel: string): Finding[] {
  const content = readFileSync(join(REPO_ROOT, rel), "utf-8");
  const lines = content.split(/\r?\n/);
  const findings: Finding[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (IGNORE_SAME_LINE.test(line)) continue;
    if (i > 0 && IGNORE_NEXT_LINE.test(lines[i - 1])) continue;

    for (const pat of DEBT_PATTERNS) {
      if (pat.re.test(line)) {
        const tdMatches = line.match(TD_ID_PATTERN) ?? [];
        findings.push({
          file: rel,
          line: i + 1,
          pattern: pat.name,
          category: pat.category,
          text: line.trim().slice(0, 220),
          hasTdId: tdMatches.length > 0,
          tdIds: tdMatches,
        });
      }
    }
  }
  return findings;
}

// ---------------------------------------------------------------------------
// Registry parsing
// ---------------------------------------------------------------------------

interface RegistryEntry {
  id: string;
  title: string;
  status: "open" | "in_progress" | "resolved" | "wontfix" | "wontfix-explained";
  severity: string;
  location: string | null;
}

function parseRegistry(): Map<string, RegistryEntry> {
  const result = new Map<string, RegistryEntry>();
  if (!existsSync(REGISTRY_PATH)) return result;

  const content = readFileSync(REGISTRY_PATH, "utf-8");
  const lines = content.split(/\r?\n/);

  let current: Partial<RegistryEntry> | null = null;
  const commit = () => {
    if (current && current.id) {
      result.set(current.id, {
        id: current.id,
        title: current.title ?? "",
        status: current.status ?? "open",
        severity: current.severity ?? "P2",
        location: current.location ?? null,
      });
    }
  };

  for (const line of lines) {
    const header = line.match(/^##\s+(TD-\d{4,}):\s*(.*)$/);
    if (header) {
      commit();
      current = {
        id: header[1],
        title: header[2].trim(),
        status: "open",
        severity: "P2",
        location: null,
      };
      continue;
    }
    if (!current) continue;

    const status = line.match(/^\s*[-*]\s+\*\*Status\*\*:\s*([^\s]+)/i);
    if (status) {
      const s = status[1].trim().toLowerCase();
      if (
        ["open", "in_progress", "resolved", "wontfix", "wontfix-explained"].includes(s)
      ) {
        current.status = s as RegistryEntry["status"];
      }
      continue;
    }

    const severity = line.match(/^\s*[-*]\s+\*\*Severity\*\*:\s*([^\s]+)/i);
    if (severity) {
      current.severity = severity[1].trim();
      continue;
    }

    const location = line.match(/^\s*[-*]\s+\*\*Location\*\*:\s*(.+)$/i);
    if (location) {
      current.location = location[1].trim();
      continue;
    }
  }
  commit();
  return result;
}

// ---------------------------------------------------------------------------
// Violation detection
// ---------------------------------------------------------------------------

interface Violation {
  type:
    | "unregistered"
    | "orphan-tdid"
    | "resolved-but-present"
    | "wontfix-but-present";
  file: string;
  line: number;
  pattern?: string;
  text?: string;
  tdId?: string;
  message: string;
}

function findViolations(
  findings: Finding[],
  registry: Map<string, RegistryEntry>,
): Violation[] {
  const violations: Violation[] = [];

  for (const f of findings) {
    if (!f.hasTdId) {
      violations.push({
        type: "unregistered",
        file: f.file,
        line: f.line,
        pattern: f.pattern,
        text: f.text,
        message: `Pattern "${f.pattern}" without a TD-XXXX reference.`,
      });
      continue;
    }
    for (const td of f.tdIds) {
      const entry = registry.get(td);
      if (!entry) {
        violations.push({
          type: "orphan-tdid",
          file: f.file,
          line: f.line,
          tdId: td,
          text: f.text,
          message: `Code references ${td} but no such entry in docs/code-debt-registry.md.`,
        });
        continue;
      }
      if (entry.status === "resolved") {
        violations.push({
          type: "resolved-but-present",
          file: f.file,
          line: f.line,
          tdId: td,
          text: f.text,
          message: `Code references ${td} which is marked 'resolved'. Remove the comment or re-open the entry.`,
        });
      } else if (entry.status === "wontfix") {
        violations.push({
          type: "wontfix-but-present",
          file: f.file,
          line: f.line,
          tdId: td,
          text: f.text,
          message: `Code references ${td} which is marked 'wontfix' (vs 'wontfix-explained'). Remove the comment or change status.`,
        });
      }
    }
  }

  return violations;
}

// ---------------------------------------------------------------------------
// Modes
// ---------------------------------------------------------------------------

function runCheck(asJson: boolean): void {
  const files = walkSourceFiles();
  let allFindings: Finding[] = [];
  for (const f of files) allFindings = allFindings.concat(scanFile(f));
  const registry = parseRegistry();
  const violations = findViolations(allFindings, registry);

  if (asJson) {
    console.log(
      JSON.stringify(
        {
          ok: violations.length === 0,
          scannedFiles: files.length,
          totalFindings: allFindings.length,
          registeredFindings: allFindings.length - violations.filter((v) => v.type === "unregistered").length,
          registryEntries: registry.size,
          openEntries: [...registry.values()].filter(
            (e) => e.status === "open" || e.status === "in_progress",
          ).length,
          violations,
        },
        null,
        2,
      ),
    );
    process.exit(violations.length === 0 ? 0 : 1);
  }

  if (violations.length === 0) {
    const open = [...registry.values()].filter(
      (e) => e.status === "open" || e.status === "in_progress",
    ).length;
    console.log(
      `${COLORS.green}✓ Code-debt check passed.${COLORS.reset}  Scanned ${files.length} files. ${allFindings.length} registered finding(s). ${open} open in registry.`,
    );
    process.exit(0);
  }

  console.log(
    `${COLORS.red}✗ Code-debt check FAILED.${COLORS.reset}  ${violations.length} violation(s):\n`,
  );

  const byType = new Map<string, Violation[]>();
  for (const v of violations) {
    if (!byType.has(v.type)) byType.set(v.type, []);
    byType.get(v.type)!.push(v);
  }

  const typeLabels: Record<string, string> = {
    unregistered: "Unregistered debt comments (need new TD-XXXX entry)",
    "orphan-tdid": "Code references a TD-XXXX that doesn't exist in registry",
    "resolved-but-present": "Code still references a TD-XXXX marked 'resolved'",
    "wontfix-but-present": "Code references a TD-XXXX marked 'wontfix' (use 'wontfix-explained')",
  };

  for (const [type, vs] of byType) {
    console.log(`${COLORS.bold}${typeLabels[type] ?? type}${COLORS.reset}  (${vs.length})`);
    for (const v of vs) {
      console.log(`  ${COLORS.yellow}${v.file}:${v.line}${COLORS.reset}`);
      console.log(`    ${v.message}`);
      if (v.text) console.log(`    ${COLORS.dim}> ${v.text}${COLORS.reset}`);
    }
    console.log();
  }

  console.log(`${COLORS.cyan}How to resolve:${COLORS.reset}`);
  console.log(`  1. Run \`npm run debt:add\` to create a registry entry interactively`);
  console.log(`     (or hand-edit ${relative(REPO_ROOT, REGISTRY_PATH)})`);
  console.log(`  2. Update the in-code comment to reference the new TD-XXXX:`);
  console.log(`       // TODO(TD-0001): your description`);
  console.log(`  3. Re-run \`npm run debt:check\``);
  console.log();
  console.log(
    `${COLORS.dim}Bypass (emergency only, document in commit):  git commit --no-verify${COLORS.reset}`,
  );
  process.exit(1);
}

function runList(): void {
  const registry = parseRegistry();
  const open = [...registry.values()].filter(
    (e) => e.status === "open" || e.status === "in_progress",
  );
  if (open.length === 0) {
    console.log(`${COLORS.green}No open code-debt entries.${COLORS.reset}`);
    return;
  }
  console.log(`${COLORS.bold}Open code-debt (${open.length}):${COLORS.reset}\n`);
  const bySev = new Map<string, RegistryEntry[]>();
  for (const e of open) {
    if (!bySev.has(e.severity)) bySev.set(e.severity, []);
    bySev.get(e.severity)!.push(e);
  }
  for (const sev of ["P0", "P1", "P2", "P3"]) {
    const entries = bySev.get(sev);
    if (!entries || entries.length === 0) continue;
    console.log(`${COLORS.bold}${sev}${COLORS.reset}  (${entries.length})`);
    for (const e of entries) {
      console.log(`  ${e.id}: ${e.title}`);
      if (e.location) console.log(`    ${COLORS.dim}${e.location}${COLORS.reset}`);
    }
    console.log();
  }
}

async function runAdd(): Promise<void> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q: string): Promise<string> =>
    new Promise((r) => rl.question(q, (a) => r(a)));

  try {
    const registry = parseRegistry();
    const nextId = nextTdId(registry);
    console.log(`${COLORS.bold}New code-debt entry: ${nextId}${COLORS.reset}\n`);
    const title = (await ask("Title (e.g., 'JWT-revoked auto-redirect to /link'): ")).trim();
    if (!title) {
      console.error("Title is required.");
      process.exit(2);
    }
    const severity = ((await ask("Severity (P0/P1/P2/P3) [P2]: ")) || "P2").trim();
    const location = (await ask("Location (file:line, optional): ")).trim();
    const description = (await ask("Description (one line): ")).trim();
    const resolution = (await ask("Resolution criteria (how do you know it's done?): ")).trim();
    const linked = (await ask("Linked docs (ADR/design/issue, optional): ")).trim();

    const today = new Date().toISOString().slice(0, 10);
    let entry = `## ${nextId}: ${title}\n\n`;
    entry += `- **Status**: open\n`;
    entry += `- **Severity**: ${severity}\n`;
    entry += `- **Created**: ${today}\n`;
    if (location) entry += `- **Location**: ${location}\n`;
    entry += `- **Description**: ${description}\n`;
    entry += `- **Resolution criteria**: ${resolution}\n`;
    if (linked) entry += `- **Linked**: ${linked}\n`;
    entry += `\n---\n\n`;

    const existing = existsSync(REGISTRY_PATH) ? readFileSync(REGISTRY_PATH, "utf-8") : "";
    writeFileSync(REGISTRY_PATH, existing + entry);

    console.log();
    console.log(`${COLORS.green}✓ Added ${nextId} to ${relative(REPO_ROOT, REGISTRY_PATH)}${COLORS.reset}`);
    console.log();
    console.log(`Now update the in-code comment to reference ${nextId}:`);
    console.log(`  ${COLORS.cyan}// TODO(${nextId}): ${title}${COLORS.reset}`);
  } finally {
    rl.close();
  }
}

function nextTdId(registry: Map<string, RegistryEntry>): string {
  let max = 0;
  for (const id of registry.keys()) {
    const n = parseInt(id.replace("TD-", ""), 10);
    if (n > max) max = n;
  }
  return `TD-${String(max + 1).padStart(4, "0")}`;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function main(): void {
  const flag = process.argv[2] ?? "--check";

  if (flag === "--check") return runCheck(false);
  if (flag === "--json") return runCheck(true);
  if (flag === "--list") return runList();
  if (flag === "--add") {
    void runAdd().catch((err) => {
      console.error(err);
      process.exit(1);
    });
    return;
  }
  console.error(`Unknown flag: ${flag}`);
  console.error("Usage:  npm run debt:check  |  debt:list  |  debt:add");
  process.exit(2);
}

main();

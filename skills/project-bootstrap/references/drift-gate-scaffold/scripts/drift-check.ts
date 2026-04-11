#!/usr/bin/env tsx
/**
 * drift-check.ts — Deployment integrity gate.
 *
 * Detects schema drift between committed migration files and actual production
 * Supabase state. Exists because "committing a migration file is not the same
 * as applying it" is the single most common silent-failure class in
 * Claude-assisted development.
 *
 * NOT a full SQL interpreter — a shallow pattern match against common DDL
 * shapes that catches 95%+ of real-world drift:
 *   - CREATE TABLE [IF NOT EXISTS] name
 *   - ALTER TABLE t ADD COLUMN [IF NOT EXISTS] c  (multi-line aware)
 *   - CREATE [UNIQUE] INDEX [IF NOT EXISTS] name
 *   - CREATE [OR REPLACE] FUNCTION name
 *   - ALTER TABLE t ADD CONSTRAINT name CHECK (col IN (...))  — value-set drift
 *
 * Known limitations (see docs/drift-gate.md "v2 roadmap"):
 *   - Does NOT track ALTER TABLE ... RENAME TO (uses an allowlist for known renames)
 *   - Does NOT parse columns declared inside initial CREATE TABLE (…)
 *   - Does NOT validate CREATE POLICY / CREATE TRIGGER content
 *
 * Usage:
 *   npm run drift                         # check all configured projects
 *   npm run drift -- --project=<name>     # check only one
 *   npm run drift -- --verbose            # dump extracted artifacts before compare
 *   npm run drift -- --json               # machine-readable output
 *
 * Exit codes: 0 = clean, 1 = drift, 2 = config error.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");

// ---------------------------------------------------------------------------
// PROJECTS — add an entry when you onboard a new Supabase project.
// Each project needs:
//   - name: human-readable identifier (matches allowlist key + CLI --project flag)
//   - migrationsDir: absolute path to the .sql files
//   - envVar: name of the env var containing the read-only DRIFT_DB_URL
//
// Creating the read-only role: see scripts/setup-drift-role.sql and docs/drift-gate.md
// ---------------------------------------------------------------------------

interface Project {
  name: string;
  migrationsDir: string;
  envVar: string;
}

const PROJECTS: Project[] = [
  // {{REPLACE: example single-project default. Customize for your project.}}
  {
    name: "default",
    migrationsDir: path.join(REPO_ROOT, "supabase/migrations"),
    envVar: "DRIFT_DB_URL_DEFAULT",
  },
];

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

interface ExpectedArtifacts {
  tables: Set<string>;
  columns: Set<string>; // "table.column"
  indexes: Set<string>;
  functions: Set<string>;
  checkConstraints: Map<string, string[]>;
}

function stripCommentsAndFunctionBodies(sql: string): string {
  let out = sql.replace(/--[^\n]*/g, "");
  out = out.replace(/\/\*[\s\S]*?\*\//g, "");
  out = out.replace(/\$([A-Za-z_][A-Za-z0-9_]*)?\$[\s\S]*?\$\1\$/g, "");
  return out;
}

function parseSqlFile(content: string): ExpectedArtifacts {
  const clean = stripCommentsAndFunctionBodies(content);
  const result: ExpectedArtifacts = {
    tables: new Set(),
    columns: new Set(),
    indexes: new Set(),
    functions: new Set(),
    checkConstraints: new Map(),
  };

  const tableRegex =
    /create\s+table\s+(?:if\s+not\s+exists\s+)?([a-z_][a-z0-9_]*)\s*[(]/gi;
  let m: RegExpExecArray | null;
  while ((m = tableRegex.exec(clean)) !== null) {
    result.tables.add(m[1]!);
  }

  const alterStmtRegex =
    /alter\s+table\s+(?:only\s+)?([a-z_][a-z0-9_]*)\s+([\s\S]*?);/gi;
  while ((m = alterStmtRegex.exec(clean)) !== null) {
    const table = m[1]!;
    const body = m[2]!;
    const colRegex =
      /add\s+column(?:\s+if\s+not\s+exists)?\s+([a-z_][a-z0-9_]*)/gi;
    let cm: RegExpExecArray | null;
    while ((cm = colRegex.exec(body)) !== null) {
      result.columns.add(`${table}.${cm[1]!}`);
    }
  }

  const indexRegex =
    /create\s+(?:unique\s+)?index\s+(?:concurrently\s+)?(?:if\s+not\s+exists\s+)?([a-z_][a-z0-9_]*)\s+on\s+/gi;
  while ((m = indexRegex.exec(clean)) !== null) {
    result.indexes.add(m[1]!);
  }

  const fnRegex =
    /create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?([a-z_][a-z0-9_]*)\s*\(/gi;
  while ((m = fnRegex.exec(clean)) !== null) {
    result.functions.add(m[1]!);
  }

  const checkRegex =
    /add\s+constraint\s+([a-z_][a-z0-9_]*)\s+check\s*\(\s*[a-z_][a-z0-9_]*\s+in\s*\(([^)]*)\)\s*\)/gi;
  while ((m = checkRegex.exec(clean)) !== null) {
    const name = m[1]!;
    const valuesBlob = m[2]!;
    const values = (valuesBlob.match(/'[^']*'/g) ?? []).map((s) =>
      s.slice(1, -1),
    );
    if (values.length > 0) result.checkConstraints.set(name, values);
  }

  return result;
}

function parseMigrationsDir(dir: string): ExpectedArtifacts {
  const merged: ExpectedArtifacts = {
    tables: new Set(),
    columns: new Set(),
    indexes: new Set(),
    functions: new Set(),
    checkConstraints: new Map(),
  };

  if (!fs.existsSync(dir)) {
    throw new Error(`Migrations directory not found: ${dir}`);
  }
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  for (const f of files) {
    const content = fs.readFileSync(path.join(dir, f), "utf-8");
    const parsed = parseSqlFile(content);
    parsed.tables.forEach((t) => merged.tables.add(t));
    parsed.columns.forEach((c) => merged.columns.add(c));
    parsed.indexes.forEach((i) => merged.indexes.add(i));
    parsed.functions.forEach((fn) => merged.functions.add(fn));
    parsed.checkConstraints.forEach((v, k) => merged.checkConstraints.set(k, v));
  }
  return merged;
}

// ---------------------------------------------------------------------------
// Allowlist
// ---------------------------------------------------------------------------

interface Allowlist {
  tables?: string[];
  columns?: string[];
  indexes?: string[];
  functions?: string[];
  checkConstraints?: string[];
  notes?: Record<string, string>;
}

function loadAllowlist(project: string): Allowlist {
  const file = path.join(REPO_ROOT, "scripts/drift-check.allowlist.json");
  if (!fs.existsSync(file)) return {};
  const all = JSON.parse(fs.readFileSync(file, "utf-8")) as Record<
    string,
    Allowlist
  >;
  return all[project] ?? {};
}

function applyAllowlist(expected: ExpectedArtifacts, allow: Allowlist): void {
  allow.tables?.forEach((t) => expected.tables.delete(t));
  allow.columns?.forEach((c) => expected.columns.delete(c));
  allow.indexes?.forEach((i) => expected.indexes.delete(i));
  allow.functions?.forEach((f) => expected.functions.delete(f));
  allow.checkConstraints?.forEach((c) => expected.checkConstraints.delete(c));
}

// ---------------------------------------------------------------------------
// DB query
// ---------------------------------------------------------------------------

interface ActualState {
  tables: Set<string>;
  columns: Set<string>;
  indexes: Set<string>;
  functions: Set<string>;
  checkConstraints: Map<string, string[]>;
}

async function fetchActualState(client: Client): Promise<ActualState> {
  const state: ActualState = {
    tables: new Set(),
    columns: new Set(),
    indexes: new Set(),
    functions: new Set(),
    checkConstraints: new Map(),
  };

  const tables = await client.query<{ tablename: string }>(
    "SELECT tablename FROM pg_tables WHERE schemaname='public'",
  );
  tables.rows.forEach((r) => state.tables.add(r.tablename));

  const columns = await client.query<{
    table_name: string;
    column_name: string;
  }>(
    "SELECT table_name, column_name FROM information_schema.columns WHERE table_schema='public'",
  );
  columns.rows.forEach((r) =>
    state.columns.add(`${r.table_name}.${r.column_name}`),
  );

  const indexes = await client.query<{ indexname: string }>(
    "SELECT indexname FROM pg_indexes WHERE schemaname='public'",
  );
  indexes.rows.forEach((r) => state.indexes.add(r.indexname));

  const functions = await client.query<{ proname: string }>(
    `SELECT proname FROM pg_proc p
     JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'`,
  );
  functions.rows.forEach((r) => state.functions.add(r.proname));

  const checks = await client.query<{ conname: string; definition: string }>(
    `SELECT conname, pg_get_constraintdef(oid) AS definition
     FROM pg_constraint WHERE contype = 'c'`,
  );
  checks.rows.forEach((r) => {
    const values = (r.definition.match(/'[^']*'/g) ?? []).map((s) =>
      s.slice(1, -1),
    );
    if (values.length > 0) state.checkConstraints.set(r.conname, values);
  });

  return state;
}

// ---------------------------------------------------------------------------
// Diff
// ---------------------------------------------------------------------------

interface DriftReport {
  project: string;
  missingTables: string[];
  missingColumns: string[];
  missingIndexes: string[];
  missingFunctions: string[];
  checkConstraintMismatches: Array<{
    name: string;
    expected: string[];
    actual: string[];
    missingValues: string[];
  }>;
  isClean: boolean;
}

function diffExpectedVsActual(
  project: string,
  expected: ExpectedArtifacts,
  actual: ActualState,
): DriftReport {
  const missingTables: string[] = [];
  expected.tables.forEach((t) => {
    if (!actual.tables.has(t)) missingTables.push(t);
  });
  const missingColumns: string[] = [];
  expected.columns.forEach((c) => {
    if (!actual.columns.has(c)) missingColumns.push(c);
  });
  const missingIndexes: string[] = [];
  expected.indexes.forEach((i) => {
    if (!actual.indexes.has(i)) missingIndexes.push(i);
  });
  const missingFunctions: string[] = [];
  expected.functions.forEach((f) => {
    if (!actual.functions.has(f)) missingFunctions.push(f);
  });

  const checkConstraintMismatches: DriftReport["checkConstraintMismatches"] =
    [];
  expected.checkConstraints.forEach((expVals, name) => {
    const actVals = actual.checkConstraints.get(name) ?? [];
    const actSet = new Set(actVals);
    const missingValues = expVals.filter((v) => !actSet.has(v));
    if (missingValues.length > 0) {
      checkConstraintMismatches.push({
        name,
        expected: expVals,
        actual: actVals,
        missingValues,
      });
    }
  });

  return {
    project,
    missingTables: missingTables.sort(),
    missingColumns: missingColumns.sort(),
    missingIndexes: missingIndexes.sort(),
    missingFunctions: missingFunctions.sort(),
    checkConstraintMismatches,
    isClean:
      missingTables.length === 0 &&
      missingColumns.length === 0 &&
      missingIndexes.length === 0 &&
      missingFunctions.length === 0 &&
      checkConstraintMismatches.length === 0,
  };
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

function printHumanReport(reports: DriftReport[]): number {
  let total = 0;
  for (const r of reports) {
    const icon = r.isClean ? "✓" : "✗";
    const status = r.isClean ? "CLEAN" : "DRIFT DETECTED";
    console.log(`\n${icon} [${r.project}] ${status}`);

    if (r.missingTables.length) {
      console.log(`  Missing tables (${r.missingTables.length}):`);
      r.missingTables.forEach((t) => console.log(`    - ${t}`));
      total += r.missingTables.length;
    }
    if (r.missingColumns.length) {
      console.log(`  Missing columns (${r.missingColumns.length}):`);
      r.missingColumns.forEach((c) => console.log(`    - ${c}`));
      total += r.missingColumns.length;
    }
    if (r.missingIndexes.length) {
      console.log(`  Missing indexes (${r.missingIndexes.length}):`);
      r.missingIndexes.forEach((i) => console.log(`    - ${i}`));
      total += r.missingIndexes.length;
    }
    if (r.missingFunctions.length) {
      console.log(`  Missing functions (${r.missingFunctions.length}):`);
      r.missingFunctions.forEach((f) => console.log(`    - ${f}`));
      total += r.missingFunctions.length;
    }
    if (r.checkConstraintMismatches.length) {
      console.log(
        `  CHECK constraint drift (${r.checkConstraintMismatches.length}):`,
      );
      r.checkConstraintMismatches.forEach((m) => {
        console.log(`    - ${m.name}`);
        console.log(`        missing values: ${m.missingValues.join(", ")}`);
      });
      total += r.checkConstraintMismatches.length;
    }
  }

  console.log("");
  if (total === 0) {
    console.log("✓ All projects clean. No drift detected.");
  } else {
    console.log(`✗ Drift detected: ${total} item(s) across all projects.`);
    console.log("");
    console.log("Fix by either:");
    console.log("  (a) Applying the missing migration(s) to the affected project");
    console.log("  (b) Adding known false positives to scripts/drift-check.allowlist.json");
  }
  return total;
}

// ---------------------------------------------------------------------------
// Env loading
// ---------------------------------------------------------------------------

function loadRootEnvLocal(): void {
  const envPath = path.join(REPO_ROOT, ".env.local");
  if (!fs.existsSync(envPath)) return;
  const content = fs.readFileSync(envPath, "utf-8");
  for (const line of content.split("\n")) {
    const match = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/);
    if (match && !process.env[match[1]!]) {
      let value = match[2]!.trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      process.env[match[1]!] = value;
    }
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function checkProject(
  project: Project,
  verbose: boolean,
): Promise<DriftReport> {
  const dbUrl = process.env[project.envVar];
  if (!dbUrl) {
    console.error(
      `[${project.name}] MISSING env var: ${project.envVar}\n` +
        `  Set it in .env.local or export it before running.`,
    );
    process.exit(2);
  }

  const expected = parseMigrationsDir(project.migrationsDir);
  const allow = loadAllowlist(project.name);
  applyAllowlist(expected, allow);

  if (verbose) {
    console.log(`[${project.name}] expected artifacts:`);
    console.log(`  tables:    ${expected.tables.size}`);
    console.log(`  columns:   ${expected.columns.size}`);
    console.log(`  indexes:   ${expected.indexes.size}`);
    console.log(`  functions: ${expected.functions.size}`);
    console.log(`  CHECK:     ${expected.checkConstraints.size}`);
  }

  const client = new Client({ connectionString: dbUrl });
  try {
    await client.connect();
    const actual = await fetchActualState(client);
    if (verbose) {
      console.log(`[${project.name}] actual prod state:`);
      console.log(`  tables:    ${actual.tables.size}`);
      console.log(`  columns:   ${actual.columns.size}`);
      console.log(`  indexes:   ${actual.indexes.size}`);
      console.log(`  functions: ${actual.functions.size}`);
      console.log(`  CHECK:     ${actual.checkConstraints.size}`);
    }
    return diffExpectedVsActual(project.name, expected, actual);
  } catch (err) {
    console.error(
      `[${project.name}] Failed to query database: ${(err as Error).message}`,
    );
    process.exit(2);
  } finally {
    await client.end().catch(() => {});
  }
}

async function main(): Promise<void> {
  loadRootEnvLocal();

  const args = process.argv.slice(2);
  const jsonMode = args.includes("--json");
  const verbose = args.includes("--verbose");
  const projectFilter = args
    .find((a) => a.startsWith("--project="))
    ?.split("=")[1];

  const projectsToCheck = projectFilter
    ? PROJECTS.filter((p) => p.name === projectFilter)
    : PROJECTS;

  if (projectsToCheck.length === 0) {
    console.error(`No projects matched filter: ${projectFilter}`);
    console.error(`Available: ${PROJECTS.map((p) => p.name).join(", ")}`);
    process.exit(2);
  }

  const reports: DriftReport[] = [];
  for (const p of projectsToCheck) {
    reports.push(await checkProject(p, verbose));
  }

  if (jsonMode) {
    console.log(JSON.stringify(reports, null, 2));
    const anyDrift = reports.some((r) => !r.isClean);
    process.exit(anyDrift ? 1 : 0);
  }

  const totalDrift = printHumanReport(reports);
  process.exit(totalDrift > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(2);
});

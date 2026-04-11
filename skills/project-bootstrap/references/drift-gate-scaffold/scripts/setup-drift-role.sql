-- Idempotent setup script for the drift_reader Postgres role.
-- Run this once per Supabase project against the `postgres` superuser.
--
-- Usage:
--   DRIFT_PW=$(openssl rand -hex 32)
--   psql "$DATABASE_URL" --single-transaction -v pw="'$DRIFT_PW'" -f scripts/setup-drift-role.sql
--
-- After running, build the pooler connection string:
--   postgresql://drift_reader.<project_ref>:$DRIFT_PW@aws-<region>.pooler.supabase.com:5432/postgres
--
-- Add to .env.local AND to GitHub Actions secrets as DRIFT_DB_URL_<PROJECT>.
--
-- Security model:
--   - drift_reader has LOGIN + pg_read_all_data (built-in Postgres 14+ role)
--   - pg_read_all_data grants SELECT on all tables + USAGE on all schemas
--   - Does NOT set BYPASSRLS — RLS-protected content remains filtered
--   - Rotate password every 90 days by re-running this script

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'drift_reader') THEN
    EXECUTE 'ALTER ROLE drift_reader WITH LOGIN PASSWORD ' || :'pw';
    RAISE NOTICE 'drift_reader role exists — password rotated';
  ELSE
    EXECUTE 'CREATE ROLE drift_reader WITH LOGIN PASSWORD ' || :'pw';
    RAISE NOTICE 'drift_reader role created';
  END IF;
END
$$;

GRANT pg_read_all_data TO drift_reader;

SELECT
  r.rolname,
  r.rolcanlogin,
  ARRAY_AGG(m.rolname ORDER BY m.rolname) FILTER (WHERE m.rolname IS NOT NULL) AS memberships
FROM pg_roles r
LEFT JOIN pg_auth_members a ON a.member = r.oid
LEFT JOIN pg_roles m ON m.oid = a.roleid
WHERE r.rolname = 'drift_reader'
GROUP BY r.rolname, r.rolcanlogin;

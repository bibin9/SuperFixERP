-- 015 Reports (FSD 4.16): saved and copied reports, sharing, scheduled preparation into a report inbox,
-- the personal reports dashboard, and the archive of old closed transactions.

-- 1. A saved report is either a copy of a standard report (columns chosen, renamed and ordered, default
--    filters) or a report built in the report builder from a curated data source (RB-01 to RB-08).
CREATE TABLE report_definition (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
  kind text NOT NULL CHECK (kind IN ('builder','copy')),
  base_code text,
  source text,
  spec jsonb NOT NULL DEFAULT '{}',
  owner_id uuid NOT NULL REFERENCES app_user(id),
  in_menu boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1,
  CHECK ((kind = 'builder') = (source IS NOT NULL)),
  CHECK ((kind = 'copy') = (base_code IS NOT NULL))
);
CREATE INDEX report_definition_owner_idx ON report_definition (owner_id);

-- Shared with a role (everyone holding it at any branch) or with one user (RB-07).
CREATE TABLE report_share (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id uuid NOT NULL REFERENCES report_definition(id) ON DELETE CASCADE,
  role_id uuid REFERENCES role(id),
  user_id uuid REFERENCES app_user(id),
  CHECK (num_nonnulls(role_id, user_id) = 1)
);
CREATE UNIQUE INDEX report_share_uq ON report_share (report_id, coalesce(role_id, user_id));

-- 2. Scheduled preparation (RB-10): the report is prepared daily, weekly or monthly into the user's inbox.
--    report_ref is 'std:<code>' for a standard report or 'def:<uuid>' for a saved one.
CREATE TABLE report_schedule (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_ref text NOT NULL CHECK (report_ref ~ '^(std|def):'),
  title text NOT NULL,
  user_id uuid NOT NULL REFERENCES app_user(id),
  frequency text NOT NULL CHECK (frequency IN ('daily','weekly','monthly')),
  params jsonb NOT NULL DEFAULT '{}',
  next_due date NOT NULL,
  last_prepared_at timestamptz,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX report_schedule_user_idx ON report_schedule (user_id, next_due) WHERE active;

CREATE TABLE report_inbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES app_user(id),
  schedule_id uuid REFERENCES report_schedule(id) ON DELETE SET NULL,
  report_ref text NOT NULL,
  title text NOT NULL,
  period_label text,
  row_count integer NOT NULL DEFAULT 0,
  file bytea NOT NULL,
  prepared_at timestamptz NOT NULL DEFAULT now(),
  opened_at timestamptz
);
CREATE INDEX report_inbox_user_idx ON report_inbox (user_id, prepared_at DESC);

-- 3. Each user's reports dashboard: pinned reports, shown as a table or a chart (RB-07 "add to a dashboard").
CREATE TABLE dashboard (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES app_user(id),
  name text NOT NULL DEFAULT 'My reports'
);
CREATE TABLE dashboard_widget (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dashboard_id uuid NOT NULL REFERENCES dashboard(id) ON DELETE CASCADE,
  report_ref text NOT NULL CHECK (report_ref ~ '^(std|def):'),
  title text NOT NULL,
  chart text NOT NULL DEFAULT 'table' CHECK (chart IN ('table','bar','line','pie')),
  position integer NOT NULL DEFAULT 0,
  UNIQUE (dashboard_id, report_ref)
);

-- 4. Archive (AR-01 to AR-06). A run marks closed, paid and posted transactions older than the live window as
--    archived. Archived rows stay in the same database, are read only, and are reported through the
--    Live / Archived selector. Masters are never archived. Ledger balances are not changed by archiving.
CREATE TABLE archive_run (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_no integer GENERATED ALWAYS AS IDENTITY UNIQUE,
  cutoff date NOT NULL,
  live_months integer NOT NULL,
  run_by uuid NOT NULL REFERENCES app_user(id),
  run_at timestamptz NOT NULL DEFAULT now(),
  counts jsonb NOT NULL DEFAULT '{}',
  ledger_check jsonb NOT NULL DEFAULT '{}',
  note text,
  keep_until date NOT NULL
);
CREATE TABLE archive_member (
  tbl text NOT NULL CHECK (tbl IN ('job_card','quotation','sales_invoice','receipt','purchase_order','supplier_bill','stock_move','transfer','payroll_run','journal')),
  row_id text NOT NULL,
  run_id uuid NOT NULL REFERENCES archive_run(id),
  PRIMARY KEY (tbl, row_id)
);
CREATE INDEX archive_member_run_idx ON archive_member (run_id);

-- An archived document can no longer be changed or deleted. (Journals and stock moves are append-only already.)
CREATE FUNCTION archived_read_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM archive_member WHERE tbl = TG_TABLE_NAME AND row_id = OLD.id::text) THEN
    RAISE EXCEPTION 'This % is archived and is read only.', replace(TG_TABLE_NAME, '_', ' ');
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['job_card','quotation','sales_invoice','receipt','purchase_order','supplier_bill','transfer','payroll_run'] LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION archived_read_only()', t || '_archived_ro', t);
  END LOOP;
END $$;
-- Archive membership itself is never edited or removed by the application.
CREATE TRIGGER archive_member_append_only BEFORE UPDATE OR DELETE ON archive_member FOR EACH ROW EXECUTE FUNCTION forbid_change();
CREATE TRIGGER archive_run_append_only BEFORE UPDATE OR DELETE ON archive_run FOR EACH ROW EXECUTE FUNCTION forbid_change();

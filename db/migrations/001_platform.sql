-- 001 Platform (FSD phase 0): company, branches, roles, permissions, field permissions,
-- users, sessions, numbering, settings, audit log, workflow engine core.
-- Conventions (FSD 6.1): uuid ids, created/updated stamps, version for optimistic locking,
-- money numeric(14,2), qty numeric(14,3).

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Branch scope helper used by every row-level security policy (FSD 3.1, 6.3).
-- The app sets app.branch_ids (comma separated uuids) and app.all_branches per transaction.
CREATE OR REPLACE FUNCTION app_branch_ok(b uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT coalesce(current_setting('app.all_branches', true), '') = 'on'
      OR (b IS NOT NULL AND b::text = ANY (string_to_array(coalesce(current_setting('app.branch_ids', true), ''), ',')))
$$;

CREATE OR REPLACE FUNCTION app_user_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.user_id', true), '')::uuid
$$;

CREATE TABLE company (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legal_name_en text NOT NULL,
  legal_name_ar text,
  trade_licence_no text,
  trade_licence_expiry date,
  trn char(15) CHECK (trn ~ '^[0-9]{15}$'),
  address text,
  base_currency char(3) NOT NULL DEFAULT 'AED',
  fy_start_month int NOT NULL DEFAULT 1 CHECK (fy_start_month BETWEEN 1 AND 12),
  vat_period text NOT NULL DEFAULT 'quarterly',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version int NOT NULL DEFAULT 1
);

CREATE TABLE branch (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE CHECK (code ~ '^[A-Z0-9]{2,6}$'),
  name_en text NOT NULL,
  name_ar text,
  branch_type text NOT NULL DEFAULT 'workshop' CHECK (branch_type IN ('workshop','head_office','warehouse')),
  emirate text NOT NULL CHECK (emirate IN ('Abu Dhabi','Dubai','Sharjah','Ajman','Umm Al Quwain','Ras Al Khaimah','Fujairah')),
  address text,
  phone text,
  whatsapp_number text,
  whatsapp_mode text NOT NULL DEFAULT 'manual' CHECK (whatsapp_mode IN ('manual','automatic')),
  opening_hours text,
  cost_centre text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  version int NOT NULL DEFAULT 1
);

CREATE TABLE bay (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES branch(id),
  code text NOT NULL,
  bay_type text NOT NULL DEFAULT 'general' CHECK (bay_type IN ('lift','alignment','tyre','wash','general')),
  active boolean NOT NULL DEFAULT true,
  UNIQUE (branch_id, code)
);

CREATE TABLE role (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  home_screen text NOT NULL DEFAULT 'home',
  is_admin boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  version int NOT NULL DEFAULT 1
);

-- Screen x action matrix (FSD 3.2). Presence of a row = granted.
CREATE TABLE permission (
  role_id uuid NOT NULL REFERENCES role(id) ON DELETE CASCADE,
  screen text NOT NULL,
  action text NOT NULL CHECK (action IN ('view','create','edit','approve','cancel','export')),
  PRIMARY KEY (role_id, screen, action)
);

-- Sensitive field register (FSD 3.3).
CREATE TABLE field_group (
  code text PRIMARY KEY,
  name text NOT NULL,
  fields text NOT NULL,
  derived text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE field_permission (
  role_id uuid NOT NULL REFERENCES role(id) ON DELETE CASCADE,
  field_group text NOT NULL REFERENCES field_group(code),
  level text NOT NULL CHECK (level IN ('hidden','view','edit')),
  PRIMARY KEY (role_id, field_group)
);

CREATE TABLE app_user (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username text NOT NULL UNIQUE CHECK (username = lower(username)),
  full_name text NOT NULL,
  mobile text,
  email text,
  password_hash text NOT NULL,
  pin_hash text,
  language text NOT NULL DEFAULT 'en' CHECK (language IN ('en','ar')),
  default_branch_id uuid REFERENCES branch(id),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
  failed_attempts int NOT NULL DEFAULT 0,
  locked_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  version int NOT NULL DEFAULT 1
);

-- One role per branch per user; branch_id NULL = all branches (owner / head office).
CREATE TABLE user_branch_role (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  branch_id uuid REFERENCES branch(id),
  role_id uuid NOT NULL REFERENCES role(id)
);
CREATE UNIQUE INDEX user_branch_role_uq ON user_branch_role (user_id, coalesce(branch_id, '00000000-0000-0000-0000-000000000000'::uuid));

CREATE TABLE session (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash text NOT NULL UNIQUE,
  user_id uuid NOT NULL REFERENCES app_user(id),
  current_branch_id uuid REFERENCES branch(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  ip text,
  device text
);

CREATE TABLE login_event (
  id bigserial PRIMARY KEY,
  at timestamptz NOT NULL DEFAULT now(),
  user_id uuid,
  username text,
  event text NOT NULL CHECK (event IN ('login','login_failed','pin_login','logout','branch_switch','locked','disabled')),
  branch_id uuid,
  ip text,
  device text
);

-- Document numbering (FSD 3.4): one series per branch and document type.
CREATE TABLE doc_series (
  branch_id uuid NOT NULL REFERENCES branch(id),
  doc_type text NOT NULL,
  prefix text NOT NULL,
  next_number bigint NOT NULL DEFAULT 1 CHECK (next_number > 0),
  padding int NOT NULL DEFAULT 6 CHECK (padding BETWEEN 1 AND 10),
  year_part boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (branch_id, doc_type)
);

-- Settings (BRD 7.14: thresholds live in data, never in code). branch_id NULL = company default.
CREATE TABLE setting (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL,
  branch_id uuid REFERENCES branch(id),
  value jsonb NOT NULL,
  grp text NOT NULL DEFAULT 'General',
  description text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);
CREATE UNIQUE INDEX setting_uq ON setting (key, coalesce(branch_id, '00000000-0000-0000-0000-000000000000'::uuid));

-- Audit trail (FSD 3.6): append-only.
CREATE TABLE audit_log (
  id bigserial PRIMARY KEY,
  at timestamptz NOT NULL DEFAULT now(),
  user_id uuid,
  branch_id uuid,
  entity text NOT NULL,
  entity_id text,
  action text NOT NULL,
  changes jsonb,
  ip text,
  device text
);
CREATE INDEX audit_log_entity_idx ON audit_log (entity, entity_id);
CREATE INDEX audit_log_at_idx ON audit_log (at DESC);

CREATE OR REPLACE FUNCTION forbid_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END $$;
CREATE TRIGGER audit_log_append_only BEFORE UPDATE OR DELETE ON audit_log FOR EACH ROW EXECUTE FUNCTION forbid_change();
CREATE TRIGGER login_event_append_only BEFORE UPDATE OR DELETE ON login_event FOR EACH ROW EXECUTE FUNCTION forbid_change();

-- Workflow engine (M10).
CREATE TABLE workflow (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_type text NOT NULL UNIQUE,
  name text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  version int NOT NULL DEFAULT 1
);

CREATE TABLE workflow_step (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id uuid NOT NULL REFERENCES workflow(id) ON DELETE CASCADE,
  seq int NOT NULL,
  name text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  -- conditions, combined with AND (WF-03); NULL = no condition
  cond_branch_id uuid REFERENCES branch(id),
  cond_min_amount numeric(14,2),
  cond_max_amount numeric(14,2),
  cond_min_discount_pct numeric(9,4),
  -- approver (WF-04): role resolved at the document's branch, or a named user
  approver_role_id uuid REFERENCES role(id),
  approver_user_id uuid REFERENCES app_user(id),
  approver_role_scope text NOT NULL DEFAULT 'doc_branch' CHECK (approver_role_scope IN ('doc_branch','supplying_branch','any_branch')),
  backup_user_id uuid REFERENCES app_user(id),
  reminder_hours int,
  escalate_hours int,
  CHECK (approver_role_id IS NOT NULL OR approver_user_id IS NOT NULL),
  UNIQUE (workflow_id, seq)
);

CREATE TABLE approval_request (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES branch(id),
  approver_branch_id uuid REFERENCES branch(id),
  doc_type text NOT NULL,
  doc_id uuid NOT NULL,
  doc_ref text NOT NULL,
  amount numeric(14,2),
  discount_pct numeric(9,4),
  summary jsonb,
  requested_by uuid NOT NULL REFERENCES app_user(id),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','sent_back','recalled')),
  current_seq int,
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz,
  version int NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX approval_request_one_pending ON approval_request (doc_type, doc_id) WHERE status = 'pending';

CREATE TABLE approval_task (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES approval_request(id),
  branch_id uuid NOT NULL REFERENCES branch(id),
  step_id uuid REFERENCES workflow_step(id),
  seq int NOT NULL,
  step_name text NOT NULL,
  approver_role_id uuid REFERENCES role(id),
  approver_branch_id uuid REFERENCES branch(id),
  approver_user_id uuid REFERENCES app_user(id),
  backup_user_id uuid REFERENCES app_user(id),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','sent_back','cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  acted_at timestamptz
);

CREATE TABLE approval_action (
  id bigserial PRIMARY KEY,
  request_id uuid NOT NULL REFERENCES approval_request(id),
  branch_id uuid NOT NULL REFERENCES branch(id),
  task_id uuid REFERENCES approval_task(id),
  user_id uuid REFERENCES app_user(id),
  action text NOT NULL CHECK (action IN ('submitted','auto_approved','approved','rejected','sent_back','recalled')),
  comment text,
  channel text NOT NULL DEFAULT 'web',
  at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER approval_action_append_only BEFORE UPDATE OR DELETE ON approval_action FOR EACH ROW EXECUTE FUNCTION forbid_change();

-- Branch row security on transaction tables (FSD 3.1 rule 2).
ALTER TABLE approval_request ENABLE ROW LEVEL SECURITY;
ALTER TABLE approval_task ENABLE ROW LEVEL SECURITY;
ALTER TABLE approval_action ENABLE ROW LEVEL SECURITY;
-- An approval request is visible to the document's branch and to the approving (e.g. supplying) branch.
CREATE POLICY branch_scope ON approval_request USING (app_branch_ok(branch_id) OR app_branch_ok(approver_branch_id)) WITH CHECK (app_branch_ok(branch_id) OR app_branch_ok(approver_branch_id));
CREATE POLICY branch_scope ON approval_task USING (app_branch_ok(branch_id) OR app_branch_ok(approver_branch_id)) WITH CHECK (app_branch_ok(branch_id) OR app_branch_ok(approver_branch_id));
CREATE POLICY branch_scope ON approval_action USING (EXISTS (SELECT 1 FROM approval_request r WHERE r.id = request_id)) WITH CHECK (EXISTS (SELECT 1 FROM approval_request r WHERE r.id = request_id));

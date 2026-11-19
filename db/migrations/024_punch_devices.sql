-- 024 Punching machines (demo: machines per branch, online or offline, synced punches) and missing-punch fixes.
-- Each machine (or the small sync program beside it) sends punches to /api/punch with its own key.
CREATE TABLE punch_device (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES branch(id),
  code text NOT NULL UNIQUE CHECK (code ~ '^[A-Z0-9-]{2,20}$'),
  name text NOT NULL,
  model text,
  key_hash text UNIQUE,
  active boolean NOT NULL DEFAULT true,
  last_sync_at timestamptz,
  last_sync_count int,
  created_by uuid, created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE punch_device ENABLE ROW LEVEL SECURITY;
CREATE POLICY branch_scope ON punch_device USING (app_branch_ok(branch_id)) WITH CHECK (app_branch_ok(branch_id));

-- The sync endpoint has no signed-in user: it resolves the machine key to the machine and branch.
CREATE OR REPLACE FUNCTION punch_device_by_key_hash(p_hash text)
RETURNS TABLE (id uuid, branch_id uuid, code text) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT d.id, d.branch_id, d.code FROM punch_device d JOIN branch b ON b.id = d.branch_id WHERE d.key_hash = p_hash AND d.active AND b.active
$$;


-- Machines know staff by employee number only; this maps it to the employee and their branch.
CREATE OR REPLACE FUNCTION employee_for_punch(p_emp_no text)
RETURNS TABLE (id uuid, branch_id uuid) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT e.id, e.branch_id FROM employee e WHERE e.emp_no = p_emp_no AND e.status = 'active'
$$;

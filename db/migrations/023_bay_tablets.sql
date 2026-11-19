-- 023 Quick PIN sign-in on shared bay tablets (demo: technicians tap their name and type a 4-digit PIN).
-- A tablet is registered by a manager and holds a long secret in a cookie; the PIN only works on a
-- registered tablet, only for technicians of that tablet's branch, and only opens the technician screens.
CREATE TABLE bay_tablet (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES branch(id),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 60),
  token_hash text NOT NULL UNIQUE,
  active boolean NOT NULL DEFAULT true,
  created_by uuid, created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz
);
ALTER TABLE bay_tablet ENABLE ROW LEVEL SECURITY;
CREATE POLICY branch_scope ON bay_tablet USING (app_branch_ok(branch_id)) WITH CHECK (app_branch_ok(branch_id));

-- The tablet page has no signed-in user yet: it resolves its own cookie to the branch.
CREATE OR REPLACE FUNCTION tablet_by_token_hash(p_hash text)
RETURNS TABLE (id uuid, branch_id uuid, name text) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT t.id, t.branch_id, t.name FROM bay_tablet t JOIN branch b ON b.id = t.branch_id WHERE t.token_hash = p_hash AND t.active AND b.active
$$;

ALTER TABLE session ADD COLUMN pin_only boolean NOT NULL DEFAULT false;
ALTER TABLE session ADD COLUMN tablet_id uuid REFERENCES bay_tablet(id);
ALTER TABLE app_user ADD COLUMN pin_set_at timestamptz;

CREATE OR REPLACE FUNCTION tablet_branch(p_id uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT t.branch_id FROM bay_tablet t JOIN branch b ON b.id = t.branch_id WHERE t.id = p_id AND t.active AND b.active
$$;

CREATE OR REPLACE FUNCTION tablet_used(p_id uuid)
RETURNS void LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public AS $$
  UPDATE bay_tablet SET last_used_at = now() WHERE id = p_id
$$;

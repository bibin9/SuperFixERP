-- 025 After-hours key drop (demo): the customer scans the QR code on the key box, fills a short web form
-- on the phone (no app), drops the key, and an advisor completes the check-in the next morning.
ALTER TABLE branch ADD COLUMN keydrop_code text UNIQUE DEFAULT encode(sha256((gen_random_uuid()::text || random()::text)::bytea), 'hex');
UPDATE branch SET keydrop_code = encode(sha256((id::text || random()::text || clock_timestamp()::text)::bytea), 'hex') WHERE keydrop_code IS NULL;

CREATE TABLE key_drop (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES branch(id),
  doc_no text NOT NULL UNIQUE,
  title text,
  name text NOT NULL CHECK (length(name) BETWEEN 2 AND 120),
  mobile text NOT NULL CHECK (mobile ~ '^\+[0-9]{8,15}$'),
  registered_in text, plate_code text, plate_number text NOT NULL CHECK (length(plate_number) BETWEEN 1 AND 10),
  make_model text,
  odometer int CHECK (odometer IS NULL OR odometer BETWEEN 0 AND 5000000),
  service_asked text NOT NULL CHECK (length(service_asked) <= 300),
  complaints text CHECK (complaints IS NULL OR length(complaints) <= 2000),
  valuables text CHECK (valuables IS NULL OR length(valuables) <= 300),
  key_slot text CHECK (key_slot IS NULL OR length(key_slot) <= 10),
  signature text CHECK (signature IS NULL OR length(signature) <= 400000),
  agreed_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting','checked_in','cancelled')),
  enquiry_id uuid REFERENCES enquiry(id),
  done_by uuid, done_at timestamptz, cancel_reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX key_drop_open ON key_drop (branch_id, status);
ALTER TABLE key_drop ENABLE ROW LEVEL SECURITY;
CREATE POLICY branch_scope ON key_drop USING (app_branch_ok(branch_id)) WITH CHECK (app_branch_ok(branch_id));

-- The public form has no signed-in user: the code on the key box resolves to the branch.
CREATE OR REPLACE FUNCTION keydrop_branch_by_code(p_code text)
RETURNS TABLE (id uuid, code text, name_en text, phone text) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT b.id, b.code, b.name_en, b.phone FROM branch b WHERE b.keydrop_code = p_code AND length(p_code) >= 32 AND b.active
$$;

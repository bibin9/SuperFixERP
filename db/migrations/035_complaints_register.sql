-- 035 OT-03: customer complaints register. One case per complaint, with its branch, customer, job card,
-- an owner who deals with it, the actions taken and the closure. A low feedback rating can open a case.
CREATE TABLE complaint_case (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES branch(id),
  doc_no text NOT NULL UNIQUE,
  customer_id uuid NOT NULL REFERENCES customer(id),
  job_card_id uuid REFERENCES job_card(id),
  feedback_id uuid REFERENCES job_feedback(id),
  source text NOT NULL,
  description text NOT NULL CHECK (btrim(description) <> ''),
  owner_id uuid REFERENCES app_user(id),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','closed')),
  due_date date,
  resolution text,
  opened_by uuid, opened_at timestamptz NOT NULL DEFAULT now(),
  closed_by uuid, closed_at timestamptz,
  CHECK (status <> 'closed' OR (resolution IS NOT NULL AND closed_at IS NOT NULL))
);
CREATE UNIQUE INDEX complaint_case_feedback ON complaint_case (feedback_id) WHERE feedback_id IS NOT NULL;
CREATE INDEX complaint_case_open ON complaint_case (branch_id, status);
CREATE TABLE complaint_action (
  id bigserial PRIMARY KEY,
  case_id uuid NOT NULL REFERENCES complaint_case(id),
  branch_id uuid NOT NULL REFERENCES branch(id),
  kind text NOT NULL DEFAULT 'note',
  note text NOT NULL,
  user_id uuid,
  at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE complaint_case ENABLE ROW LEVEL SECURITY;
CREATE POLICY branch_scope ON complaint_case USING (app_branch_ok(branch_id)) WITH CHECK (app_branch_ok(branch_id));
ALTER TABLE complaint_action ENABLE ROW LEVEL SECURITY;
CREATE POLICY branch_scope ON complaint_action USING (app_branch_ok(branch_id)) WITH CHECK (app_branch_ok(branch_id));

INSERT INTO doc_series (branch_id, doc_type, prefix, next_number, padding, year_part)
SELECT b.id, 'complaint', b.code || '-CMP-', 1, 5, true FROM branch b
WHERE NOT EXISTS (SELECT 1 FROM doc_series s WHERE s.branch_id = b.id AND s.doc_type = 'complaint');

INSERT INTO lookup_value (list, code, name_en, sort)
SELECT 'complaint_source', v.code, v.name_en, v.sort FROM (VALUES ('walk_in','At the counter',1), ('phone','Phone call',2), ('whatsapp','WhatsApp',3), ('email','Email',4), ('feedback','Low feedback rating',5)) v(code, name_en, sort)
WHERE NOT EXISTS (SELECT 1 FROM lookup_value l WHERE l.list = 'complaint_source' AND l.code = v.code);
INSERT INTO setting (key, value, grp, description)
SELECT 'complaints.days_to_close', '3', 'Front office', 'A complaint should be closed within this many days of being opened; later ones are shown as overdue'
WHERE NOT EXISTS (SELECT 1 FROM setting WHERE key = 'complaints.days_to_close' AND branch_id IS NULL);

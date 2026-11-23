-- 039 OT-05: warranty claims to suppliers for failed parts and tyres. A claim records the failed part
-- (from a job or from the shelf), is sent back to the supplier, and ends in a credit, a replacement
-- part, or a rejection. A part taken off the shelf leaves stock when it is sent; a credit or a
-- replacement reduces the warranty cost.
CREATE TABLE supplier_claim (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES branch(id),
  doc_no text NOT NULL UNIQUE,
  supplier_id uuid NOT NULL REFERENCES supplier(id),
  item_id uuid NOT NULL REFERENCES item(id),
  qty numeric(14,3) NOT NULL CHECK (qty > 0),
  serial_no text,
  job_card_id uuid REFERENCES job_card(id),
  from_stock boolean NOT NULL DEFAULT false,
  fault text NOT NULL CHECK (btrim(fault) <> ''),
  unit_cost numeric(14,4) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','sent','credited','replaced','rejected')),
  sent_at timestamptz, sent_by uuid, sent_ref text,
  outcome_at timestamptz, outcome_by uuid, outcome_note text, supplier_ref text,
  credit_amount numeric(14,2), credit_vat numeric(14,2),
  created_by uuid, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX supplier_claim_open ON supplier_claim (branch_id, status);
ALTER TABLE supplier_claim ENABLE ROW LEVEL SECURITY;
CREATE POLICY branch_scope ON supplier_claim USING (app_branch_ok(branch_id)) WITH CHECK (app_branch_ok(branch_id));

ALTER TABLE stock_move DROP CONSTRAINT stock_move_move_type_check;
ALTER TABLE stock_move ADD CONSTRAINT stock_move_move_type_check CHECK (move_type IN ('opening','receipt','issue','return','adjustment','transfer_out','transfer_in','sale','warranty','supplier_return','supplier_claim'));

INSERT INTO doc_series (branch_id, doc_type, prefix, next_number, padding, year_part)
SELECT b.id, 'supplier_claim', b.code || '-SWC-', 1, 5, true FROM branch b
WHERE NOT EXISTS (SELECT 1 FROM doc_series s WHERE s.branch_id = b.id AND s.doc_type = 'supplier_claim');
INSERT INTO setting (key, value, grp, description)
SELECT 'claims.days_to_answer', '30', 'Purchasing', 'A supplier warranty claim sent this many days ago without an answer is shown as overdue'
WHERE NOT EXISTS (SELECT 1 FROM setting WHERE key = 'claims.days_to_answer' AND branch_id IS NULL);

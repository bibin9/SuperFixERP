-- 038 PU-08: ask several suppliers for a price, compare their quotes on price and lead time, and order
-- each line from the supplier chosen. Ordering makes draft purchase orders that go through normal approval.
CREATE TABLE rfq (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES branch(id),
  doc_no text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','ordered','cancelled')),
  needed_by date,
  note text,
  created_by uuid, created_at timestamptz NOT NULL DEFAULT now(),
  ordered_by uuid, ordered_at timestamptz
);
CREATE TABLE rfq_line (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rfq_id uuid NOT NULL REFERENCES rfq(id),
  branch_id uuid NOT NULL REFERENCES branch(id),
  line_no int NOT NULL,
  item_id uuid REFERENCES item(id),
  description text NOT NULL CHECK (btrim(description) <> ''),
  qty numeric(14,3) NOT NULL CHECK (qty > 0),
  chosen_quote_id uuid,
  po_id uuid REFERENCES purchase_order(id),
  UNIQUE (rfq_id, line_no)
);
CREATE TABLE rfq_quote (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rfq_id uuid NOT NULL REFERENCES rfq(id),
  branch_id uuid NOT NULL REFERENCES branch(id),
  supplier_id uuid NOT NULL REFERENCES supplier(id),
  lead_days int CHECK (lead_days >= 0),
  valid_until date,
  note text,
  entered_by uuid, entered_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (rfq_id, supplier_id)
);
ALTER TABLE rfq_line ADD CONSTRAINT rfq_line_chosen FOREIGN KEY (chosen_quote_id) REFERENCES rfq_quote(id);
CREATE TABLE rfq_quote_line (
  quote_id uuid NOT NULL REFERENCES rfq_quote(id),
  rfq_line_id uuid NOT NULL REFERENCES rfq_line(id),
  branch_id uuid NOT NULL REFERENCES branch(id),
  unit_price numeric(14,4) NOT NULL CHECK (unit_price >= 0),
  PRIMARY KEY (quote_id, rfq_line_id)
);
ALTER TABLE rfq ENABLE ROW LEVEL SECURITY;
CREATE POLICY branch_scope ON rfq USING (app_branch_ok(branch_id)) WITH CHECK (app_branch_ok(branch_id));
ALTER TABLE rfq_line ENABLE ROW LEVEL SECURITY;
CREATE POLICY branch_scope ON rfq_line USING (app_branch_ok(branch_id)) WITH CHECK (app_branch_ok(branch_id));
ALTER TABLE rfq_quote ENABLE ROW LEVEL SECURITY;
CREATE POLICY branch_scope ON rfq_quote USING (app_branch_ok(branch_id)) WITH CHECK (app_branch_ok(branch_id));
ALTER TABLE rfq_quote_line ENABLE ROW LEVEL SECURITY;
CREATE POLICY branch_scope ON rfq_quote_line USING (app_branch_ok(branch_id)) WITH CHECK (app_branch_ok(branch_id));

INSERT INTO doc_series (branch_id, doc_type, prefix, next_number, padding, year_part)
SELECT b.id, 'rfq', b.code || '-RFQ-', 1, 5, true FROM branch b
WHERE NOT EXISTS (SELECT 1 FROM doc_series s WHERE s.branch_id = b.id AND s.doc_type = 'rfq');

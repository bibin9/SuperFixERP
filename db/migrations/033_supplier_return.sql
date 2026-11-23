-- 033 PU-04: goods sent back to the supplier from a goods-received note, before the supplier bills them.
-- The returned quantity can no longer be billed, and the order line is open again for a replacement.
ALTER TABLE grn_line ADD COLUMN returned_qty numeric(14,3) NOT NULL DEFAULT 0 CHECK (returned_qty >= 0);
ALTER TABLE grn_line DROP CONSTRAINT IF EXISTS grn_line_check;
ALTER TABLE grn_line ADD CONSTRAINT grn_line_billed_returned CHECK (billed_qty + returned_qty <= qty);

CREATE TABLE supplier_return (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES branch(id),
  doc_no text NOT NULL UNIQUE,
  grn_id uuid NOT NULL REFERENCES grn(id),
  supplier_id uuid NOT NULL REFERENCES supplier(id),
  reason text NOT NULL,
  note text,
  value numeric(14,2) NOT NULL,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE supplier_return_line (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  return_id uuid NOT NULL REFERENCES supplier_return(id),
  branch_id uuid NOT NULL REFERENCES branch(id),
  grn_line_id uuid NOT NULL REFERENCES grn_line(id),
  item_id uuid NOT NULL REFERENCES item(id),
  qty numeric(14,3) NOT NULL CHECK (qty > 0),
  unit_cost numeric(14,4) NOT NULL,
  value numeric(14,2) NOT NULL
);
ALTER TABLE supplier_return ENABLE ROW LEVEL SECURITY;
CREATE POLICY branch_scope ON supplier_return USING (app_branch_ok(branch_id)) WITH CHECK (app_branch_ok(branch_id));
ALTER TABLE supplier_return_line ENABLE ROW LEVEL SECURITY;
CREATE POLICY branch_scope ON supplier_return_line USING (app_branch_ok(branch_id)) WITH CHECK (app_branch_ok(branch_id));

INSERT INTO doc_series (branch_id, doc_type, prefix, next_number, padding, year_part)
SELECT b.id, 'supplier_return', b.code || '-SR-', 1, 5, true FROM branch b
WHERE NOT EXISTS (SELECT 1 FROM doc_series s WHERE s.branch_id = b.id AND s.doc_type = 'supplier_return');

INSERT INTO lookup_value (list, code, name_en, sort)
SELECT 'supplier_return_reason', v.code, v.name_en, v.sort FROM (VALUES ('wrong_part','Wrong part supplied',1), ('faulty','Faulty or damaged',2), ('excess','Delivered more than needed',3), ('not_needed','No longer needed',4), ('other','Other',5)) v(code, name_en, sort)
WHERE NOT EXISTS (SELECT 1 FROM lookup_value l WHERE l.list = 'supplier_return_reason' AND l.code = v.code);

ALTER TABLE stock_move DROP CONSTRAINT stock_move_move_type_check;
ALTER TABLE stock_move ADD CONSTRAINT stock_move_move_type_check CHECK (move_type IN ('opening','receipt','issue','return','adjustment','transfer_out','transfer_in','sale','warranty','supplier_return'));

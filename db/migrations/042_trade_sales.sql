-- 042 SL-02: trade sales on credit. A quotation becomes a sales order when the customer confirms;
-- goods go out on delivery notes (stock and cost of sales move then); one tax invoice on the
-- customer's credit terms covers what was delivered and not yet invoiced.
CREATE TABLE sales_order (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES branch(id),
  doc_no text NOT NULL UNIQUE,
  customer_id uuid NOT NULL REFERENCES customer(id),
  status text NOT NULL DEFAULT 'quote' CHECK (status IN ('quote','confirmed','partly_delivered','delivered','closed','cancelled')),
  customer_ref text,
  valid_until date,
  notes text,
  taxable_total numeric(14,2) NOT NULL DEFAULT 0,
  vat_total numeric(14,2) NOT NULL DEFAULT 0,
  grand_total numeric(14,2) NOT NULL DEFAULT 0,
  created_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  confirmed_by uuid, confirmed_at timestamptz,
  cancelled_by uuid, cancelled_at timestamptz,
  version int NOT NULL DEFAULT 1
);
CREATE INDEX sales_order_branch ON sales_order (branch_id, created_at DESC);
CREATE TABLE sales_order_line (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES sales_order(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES branch(id),
  line_no int NOT NULL,
  item_id uuid NOT NULL REFERENCES item(id),
  description text NOT NULL,
  qty numeric(14,3) NOT NULL CHECK (qty > 0),
  unit_price numeric(14,2) NOT NULL CHECK (unit_price >= 0),
  discount_amount numeric(14,2) NOT NULL DEFAULT 0,
  taxable_amount numeric(14,2) NOT NULL,
  vat_code text NOT NULL,
  vat_rate numeric(6,4) NOT NULL,
  vat_amount numeric(14,2) NOT NULL,
  line_total numeric(14,2) NOT NULL,
  delivered_qty numeric(14,3) NOT NULL DEFAULT 0,
  delivered_cost numeric(14,2) NOT NULL DEFAULT 0,
  invoiced_qty numeric(14,3) NOT NULL DEFAULT 0,
  invoiced_taxable numeric(14,2) NOT NULL DEFAULT 0,
  invoiced_vat numeric(14,2) NOT NULL DEFAULT 0,
  invoiced_cost numeric(14,2) NOT NULL DEFAULT 0,
  CHECK (delivered_qty <= qty AND invoiced_qty <= delivered_qty)
);
CREATE TABLE delivery_note (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES branch(id),
  doc_no text NOT NULL UNIQUE,
  order_id uuid NOT NULL REFERENCES sales_order(id),
  received_by_name text,
  vehicle_ref text,
  cost_value numeric(14,2) NOT NULL DEFAULT 0,
  invoice_id uuid REFERENCES sales_invoice(id),
  delivered_by uuid NOT NULL, delivered_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE delivery_note_line (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dn_id uuid NOT NULL REFERENCES delivery_note(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES branch(id),
  order_line_id uuid NOT NULL REFERENCES sales_order_line(id),
  item_id uuid NOT NULL REFERENCES item(id),
  qty numeric(14,3) NOT NULL CHECK (qty > 0),
  cost_value numeric(14,2) NOT NULL
);
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['sales_order','sales_order_line','delivery_note','delivery_note_line'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY branch_scope ON %I USING (app_branch_ok(branch_id)) WITH CHECK (app_branch_ok(branch_id))', t);
  END LOOP;
END $$;
ALTER TABLE sales_invoice DROP CONSTRAINT sales_invoice_source_check;
ALTER TABLE sales_invoice ADD CONSTRAINT sales_invoice_source_check CHECK (source IN ('job','counter','combined','trade'));
ALTER TABLE sales_invoice ADD COLUMN sales_order_id uuid REFERENCES sales_order(id);
INSERT INTO doc_series (branch_id, doc_type, prefix, next_number, padding, year_part)
SELECT b.id, t.doc_type, b.code || t.suffix, 1, 5, true FROM branch b CROSS JOIN (VALUES ('sales_order','-SO-'),('delivery_note','-DN-')) t(doc_type, suffix)
WHERE NOT EXISTS (SELECT 1 FROM doc_series s WHERE s.branch_id = b.id AND s.doc_type = t.doc_type);

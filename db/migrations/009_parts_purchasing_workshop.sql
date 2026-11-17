-- Phase 2: parts and workshop (FSD 4.5 M05, 4.6 M06, 4.7 M07, 4.8 M08).
-- Transfers between branches, stock adjustments and counts, purchasing (PO, GRN, supplier bill,
-- petty cash) and the workshop floor (assignment, clocking, part requests, QC, delivery).

-- Reference data for this phase (accounts, posting rules, workflows, numbering, pick lists, settings)
-- is loaded by scripts/seed-data.sql, like the rest of the reference data.

-- ---------- suppliers (PU-01) ----------
CREATE TABLE supplier (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name_en text NOT NULL,
  name_ar text,
  trn text CHECK (trn IS NULL OR trn ~ '^[0-9]{15}$'),
  trade_licence text,
  licence_expiry date,
  country_code text NOT NULL DEFAULT 'AE',
  phone text,
  email text,
  payment_terms_days int NOT NULL DEFAULT 30 CHECK (payment_terms_days >= 0),
  credit_limit numeric(14,2) NOT NULL DEFAULT 0 CHECK (credit_limit >= 0),
  iban text,
  brands text,
  reverse_charge boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  version int NOT NULL DEFAULT 1
);
ALTER TABLE item ADD COLUMN preferred_supplier_id uuid REFERENCES supplier(id);

-- ---------- back-order source (PC-05 to PC-07) ----------
ALTER TABLE stock_commitment ADD COLUMN source_type text CHECK (source_type IN ('transfer','po')),
  ADD COLUMN source_ref text, ADD COLUMN expected_date date;

-- ---------- transfers (ST-01 to ST-06) ----------
-- from_branch supplies, to_branch requests. Both sides can see the transfer.
CREATE TABLE transfer (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_no text NOT NULL UNIQUE,
  from_branch_id uuid NOT NULL REFERENCES branch(id),
  to_branch_id uuid NOT NULL REFERENCES branch(id),
  status text NOT NULL DEFAULT 'requested' CHECK (status IN ('requested','approved','rejected','cancelled','dispatched','received')),
  note text,
  reason text,
  requested_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  version int NOT NULL DEFAULT 1,
  CHECK (from_branch_id <> to_branch_id)
);
CREATE TABLE transfer_line (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transfer_id uuid NOT NULL REFERENCES transfer(id),
  item_id uuid NOT NULL REFERENCES item(id),
  qty numeric(14,3) NOT NULL CHECK (qty > 0),
  job_line_id uuid REFERENCES job_line(id),
  unit_cost numeric(14,4),
  dispatched_qty numeric(14,3) NOT NULL DEFAULT 0 CHECK (dispatched_qty >= 0),
  received_qty numeric(14,3) NOT NULL DEFAULT 0 CHECK (received_qty >= 0),
  short_qty numeric(14,3) NOT NULL DEFAULT 0 CHECK (short_qty >= 0),
  short_reason text,
  CHECK (received_qty + short_qty <= dispatched_qty),
  CHECK (dispatched_qty <= qty)
);
CREATE TABLE transfer_event (
  id bigserial PRIMARY KEY,
  transfer_id uuid NOT NULL REFERENCES transfer(id),
  status text NOT NULL,
  note text,
  user_id uuid,
  at timestamptz NOT NULL DEFAULT now()
);

-- ---------- adjustments (IN-09) and counts (IN-07) ----------
CREATE TABLE stock_adjustment (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES branch(id),
  doc_no text NOT NULL UNIQUE,
  reason text NOT NULL,
  note text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  count_id uuid,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  posted_at timestamptz,
  version int NOT NULL DEFAULT 1
);
CREATE TABLE stock_adjustment_line (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  adjustment_id uuid NOT NULL REFERENCES stock_adjustment(id),
  branch_id uuid NOT NULL REFERENCES branch(id),
  item_id uuid NOT NULL REFERENCES item(id),
  qty_change numeric(14,3) NOT NULL CHECK (qty_change <> 0),
  unit_cost numeric(14,4),
  value numeric(14,2)
);
CREATE TABLE stock_count (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES branch(id),
  doc_no text NOT NULL UNIQUE,
  category text,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','submitted','approved','rejected','no_difference')),
  adjustment_id uuid REFERENCES stock_adjustment(id),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  submitted_at timestamptz,
  version int NOT NULL DEFAULT 1
);
CREATE TABLE stock_count_line (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  count_id uuid NOT NULL REFERENCES stock_count(id),
  branch_id uuid NOT NULL REFERENCES branch(id),
  item_id uuid NOT NULL REFERENCES item(id),
  system_qty numeric(14,3) NOT NULL,
  counted_qty numeric(14,3) CHECK (counted_qty >= 0),
  UNIQUE (count_id, item_id)
);

-- ---------- purchasing (PU-01 to PU-07) ----------
CREATE TABLE purchase_order (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES branch(id),
  doc_no text NOT NULL UNIQUE,
  supplier_id uuid NOT NULL REFERENCES supplier(id),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','pending_approval','approved','rejected','partly_received','received','cancelled')),
  delivery_date date,
  terms text,
  note text,
  net_total numeric(14,2) NOT NULL DEFAULT 0,
  vat_total numeric(14,2) NOT NULL DEFAULT 0,
  grand_total numeric(14,2) NOT NULL DEFAULT 0,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  approved_at timestamptz,
  version int NOT NULL DEFAULT 1
);
CREATE TABLE po_line (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  po_id uuid NOT NULL REFERENCES purchase_order(id),
  branch_id uuid NOT NULL REFERENCES branch(id),
  line_no int NOT NULL,
  item_id uuid REFERENCES item(id),
  description text NOT NULL,
  qty numeric(14,3) NOT NULL CHECK (qty > 0),
  unit_price numeric(14,4) NOT NULL CHECK (unit_price >= 0),
  discount numeric(14,2) NOT NULL DEFAULT 0 CHECK (discount >= 0),
  vat_code text NOT NULL REFERENCES tax_code(code),
  net_amount numeric(14,2) NOT NULL,
  vat_amount numeric(14,2) NOT NULL,
  line_total numeric(14,2) NOT NULL,
  received_qty numeric(14,3) NOT NULL DEFAULT 0 CHECK (received_qty >= 0),
  job_line_id uuid REFERENCES job_line(id),
  UNIQUE (po_id, line_no),
  CHECK (received_qty <= qty)
);
CREATE TABLE grn (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES branch(id),
  doc_no text NOT NULL UNIQUE,
  po_id uuid NOT NULL REFERENCES purchase_order(id),
  supplier_id uuid NOT NULL REFERENCES supplier(id),
  delivery_note text,
  received_by uuid,
  received_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE grn_line (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  grn_id uuid NOT NULL REFERENCES grn(id),
  branch_id uuid NOT NULL REFERENCES branch(id),
  po_line_id uuid NOT NULL REFERENCES po_line(id),
  item_id uuid NOT NULL REFERENCES item(id),
  qty numeric(14,3) NOT NULL CHECK (qty > 0),
  damaged_qty numeric(14,3) NOT NULL DEFAULT 0 CHECK (damaged_qty >= 0),
  unit_cost numeric(14,4) NOT NULL,
  value numeric(14,2) NOT NULL,
  billed_qty numeric(14,3) NOT NULL DEFAULT 0 CHECK (billed_qty >= 0),
  CHECK (billed_qty <= qty)
);
CREATE TABLE supplier_bill (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES branch(id),
  doc_no text NOT NULL UNIQUE,
  supplier_id uuid NOT NULL REFERENCES supplier(id),
  supplier_invoice_no text NOT NULL,
  invoice_date date NOT NULL,
  due_date date,
  status text NOT NULL DEFAULT 'pending_approval' CHECK (status IN ('pending_approval','posted','rejected')),
  match_status text NOT NULL CHECK (match_status IN ('matched','mismatch','no_po')),
  net_total numeric(14,2) NOT NULL,
  vat_total numeric(14,2) NOT NULL,
  grand_total numeric(14,2) NOT NULL,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  posted_at timestamptz,
  version int NOT NULL DEFAULT 1,
  UNIQUE (supplier_id, supplier_invoice_no)
);
CREATE TABLE supplier_bill_line (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bill_id uuid NOT NULL REFERENCES supplier_bill(id),
  branch_id uuid NOT NULL REFERENCES branch(id),
  grn_line_id uuid REFERENCES grn_line(id),
  description text NOT NULL,
  expense_type text,
  qty numeric(14,3) NOT NULL CHECK (qty > 0),
  unit_price numeric(14,4) NOT NULL CHECK (unit_price >= 0),
  vat_code text NOT NULL REFERENCES tax_code(code),
  net_amount numeric(14,2) NOT NULL,
  vat_amount numeric(14,2) NOT NULL,
  received_value numeric(14,2),
  match_note text
);
CREATE TABLE petty_cash_entry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES branch(id),
  doc_no text NOT NULL UNIQUE,
  entry_date date NOT NULL DEFAULT (now() AT TIME ZONE 'Asia/Dubai')::date,
  kind text NOT NULL CHECK (kind IN ('top_up','spend')),
  supplier_name text,
  supplier_trn text CHECK (supplier_trn IS NULL OR supplier_trn ~ '^[0-9]{15}$'),
  expense_type text,
  description text,
  net_amount numeric(14,2) NOT NULL CHECK (net_amount > 0),
  vat_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (vat_amount >= 0),
  attachment_id uuid,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Attachments and photos (FSD 3.7). Kept in the database for the local build.
CREATE TABLE attachment (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES branch(id),
  entity text NOT NULL,
  entity_id uuid,
  file_name text NOT NULL,
  mime text NOT NULL,
  size_bytes int NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 5242880),
  content bytea NOT NULL,
  uploaded_by uuid,
  uploaded_at timestamptz NOT NULL DEFAULT now()
);

-- ---------- workshop floor (WS-01 to WS-10) ----------
ALTER TABLE branch ADD COLUMN board_token text UNIQUE;
UPDATE branch SET board_token = encode(gen_random_bytes(12), 'hex') WHERE board_token IS NULL;
ALTER TABLE branch ALTER COLUMN board_token SET DEFAULT encode(gen_random_bytes(12), 'hex');

CREATE TABLE job_assignment (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES branch(id),
  job_line_id uuid NOT NULL REFERENCES job_line(id),
  technician_id uuid NOT NULL REFERENCES app_user(id),
  bay_id uuid REFERENCES bay(id),
  planned_start timestamptz,
  assigned_by uuid,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (job_line_id, technician_id)
);
CREATE TABLE time_event (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES branch(id),
  job_card_id uuid NOT NULL REFERENCES job_card(id),
  job_line_id uuid NOT NULL REFERENCES job_line(id),
  technician_id uuid NOT NULL REFERENCES app_user(id),
  kind text NOT NULL CHECK (kind IN ('clock_in','pause','resume','clock_out')),
  reason text,
  at timestamptz NOT NULL DEFAULT now(),
  device text,
  corrected boolean NOT NULL DEFAULT false,
  original_at timestamptz,
  correction_reason text,
  corrected_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX time_event_tech ON time_event (technician_id, at);
CREATE TABLE part_request (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES branch(id),
  job_card_id uuid NOT NULL REFERENCES job_card(id),
  job_line_id uuid REFERENCES job_line(id),
  item_id uuid REFERENCES item(id),
  description text,
  qty numeric(14,3) NOT NULL CHECK (qty > 0),
  note text,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','issued','needs_quote','cancelled')),
  requested_by uuid,
  requested_at timestamptz NOT NULL DEFAULT now(),
  closed_by uuid,
  closed_at timestamptz
);
CREATE TABLE qc_check (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES branch(id),
  job_card_id uuid NOT NULL REFERENCES job_card(id),
  result text NOT NULL CHECK (result IN ('pass','fail')),
  items jsonb NOT NULL,
  note text,
  checked_by uuid,
  checked_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE delivery (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES branch(id),
  job_card_id uuid NOT NULL UNIQUE REFERENCES job_card(id),
  checklist jsonb NOT NULL,
  old_parts text NOT NULL CHECK (old_parts IN ('returned','disposed','none')),
  received_by_name text NOT NULL,
  signature text,
  odometer_out int NOT NULL CHECK (odometer_out >= 0),
  delivered_by uuid,
  delivered_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE job_card ADD COLUMN ready_at timestamptz, ADD COLUMN delivered_at timestamptz;

-- ---------- row security ----------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['stock_adjustment','stock_adjustment_line','stock_count','stock_count_line','purchase_order','po_line','grn','grn_line',
                           'supplier_bill','supplier_bill_line','petty_cash_entry','attachment','job_assignment','time_event','part_request','qc_check','delivery'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY branch_scope ON %I USING (app_branch_ok(branch_id)) WITH CHECK (app_branch_ok(branch_id))', t);
  END LOOP;
END $$;
-- A transfer belongs to both branches: the requester and the supplier.
ALTER TABLE transfer ENABLE ROW LEVEL SECURITY;
CREATE POLICY both_branches ON transfer USING (app_branch_ok(from_branch_id) OR app_branch_ok(to_branch_id))
  WITH CHECK (app_branch_ok(from_branch_id) OR app_branch_ok(to_branch_id));
ALTER TABLE transfer_line ENABLE ROW LEVEL SECURITY;
CREATE POLICY via_transfer ON transfer_line USING (EXISTS (SELECT 1 FROM transfer t WHERE t.id = transfer_id))
  WITH CHECK (EXISTS (SELECT 1 FROM transfer t WHERE t.id = transfer_id));
ALTER TABLE transfer_event ENABLE ROW LEVEL SECURITY;
CREATE POLICY via_transfer ON transfer_event USING (EXISTS (SELECT 1 FROM transfer t WHERE t.id = transfer_id))
  WITH CHECK (EXISTS (SELECT 1 FROM transfer t WHERE t.id = transfer_id));

-- The ledger-like tables are append-only for the application.
CREATE TRIGGER transfer_event_append_only BEFORE UPDATE OR DELETE ON transfer_event FOR EACH ROW EXECUTE FUNCTION forbid_change();


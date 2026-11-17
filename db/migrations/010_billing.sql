-- 010 Phase 3 billing (FSD 4.9, 4.11, 5.1, 5.6): split billing, warranty claims, simplified and advance
-- invoices, credit notes, advances, cheques, cash closing, car release, counter sales and price lists.
-- Schema only; reference data is in scripts/seed-data.sql.

-- ---------- invoices ----------
ALTER TABLE sales_invoice
  ADD COLUMN invoice_kind text NOT NULL DEFAULT 'tax' CHECK (invoice_kind IN ('tax','simplified')),
  ADD COLUMN source text NOT NULL DEFAULT 'job' CHECK (source IN ('job','counter')),
  ADD COLUMN bill_to_type text NOT NULL DEFAULT 'customer' CHECK (bill_to_type IN ('customer','fleet')),
  ADD COLUMN credited_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (credited_amount >= 0),
  ADD COLUMN share_token text UNIQUE DEFAULT encode(gen_random_bytes(16), 'hex'),
  ADD COLUMN bill_to_address text,
  ADD COLUMN notes text;
ALTER TABLE sales_invoice DROP CONSTRAINT IF EXISTS sales_invoice_check;
ALTER TABLE sales_invoice ADD CONSTRAINT sales_invoice_open_ok CHECK (paid_amount + credited_amount <= grand_total);
ALTER TABLE sales_invoice_line
  ADD COLUMN item_id uuid REFERENCES item(id),
  ADD COLUMN cost_value numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN credited_qty numeric(14,3) NOT NULL DEFAULT 0,
  ADD COLUMN credited_amount numeric(14,2) NOT NULL DEFAULT 0;

-- Warranty work (JC-08): an internal claim document, not a tax invoice; cost goes to warranty expense.
CREATE TABLE warranty_claim (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES branch(id),
  doc_no text NOT NULL UNIQUE,
  doc_date date NOT NULL,
  job_card_id uuid NOT NULL REFERENCES job_card(id),
  claim_ref text,
  value_at_price numeric(14,2) NOT NULL,
  cost_value numeric(14,2) NOT NULL,
  journal_id uuid REFERENCES journal(id),
  posted_by uuid,
  posted_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE job_line ADD COLUMN warranty_claim_id uuid REFERENCES warranty_claim(id);

-- ---------- credit notes (IV-05, SL-04) ----------
CREATE TABLE credit_note (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES branch(id),
  doc_no text UNIQUE,                    -- numbered when posted, so rejected requests leave no gap
  doc_date date,
  invoice_id uuid NOT NULL REFERENCES sales_invoice(id),
  customer_id uuid NOT NULL REFERENCES customer(id),
  reason text NOT NULL,
  note text,
  status text NOT NULL DEFAULT 'pending_approval' CHECK (status IN ('pending_approval','posted','rejected')),
  taxable_total numeric(14,2) NOT NULL CHECK (taxable_total >= 0),
  vat_total numeric(14,2) NOT NULL CHECK (vat_total >= 0),
  grand_total numeric(14,2) NOT NULL CHECK (grand_total > 0),
  journal_id uuid REFERENCES journal(id),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  posted_at timestamptz
);
CREATE TABLE credit_note_line (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  credit_note_id uuid NOT NULL REFERENCES credit_note(id),
  branch_id uuid NOT NULL REFERENCES branch(id),
  invoice_line_id uuid NOT NULL REFERENCES sales_invoice_line(id),
  qty numeric(14,3) NOT NULL CHECK (qty > 0),
  taxable_amount numeric(14,2) NOT NULL CHECK (taxable_amount >= 0),
  vat_amount numeric(14,2) NOT NULL CHECK (vat_amount >= 0),
  line_total numeric(14,2) NOT NULL,
  stock_action text NOT NULL DEFAULT 'none' CHECK (stock_action IN ('none','restock','scrap'))
);

-- ---------- advances, deposits and receipts (PY-01, PY-02, AC-17) ----------
ALTER TABLE receipt
  ADD COLUMN kind text NOT NULL DEFAULT 'invoice' CHECK (kind IN ('invoice','advance')),
  ADD COLUMN job_card_id uuid REFERENCES job_card(id),
  ADD COLUMN vat_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (vat_amount >= 0),
  ADD COLUMN cheque_no text,
  ADD COLUMN cheque_bank text,
  ADD COLUMN cheque_date date,
  ADD COLUMN cheque_status text CHECK (cheque_status IN ('held','cleared','bounced')),
  ADD COLUMN cheque_event_at timestamptz,
  ADD COLUMN cheque_note text;
ALTER TABLE receipt_allocation ADD COLUMN reversed boolean NOT NULL DEFAULT false;

-- Money held for a customer: an advance or deposit (with VAT when received before supply), an overpayment,
-- or a credit note above the open amount. Applied to later invoices.
CREATE TABLE customer_advance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES branch(id),
  customer_id uuid NOT NULL REFERENCES customer(id),
  job_card_id uuid REFERENCES job_card(id),
  source text NOT NULL CHECK (source IN ('advance','overpayment','credit_note')),
  source_id uuid NOT NULL,
  source_no text NOT NULL,
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  vat_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (vat_amount >= 0),
  used_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (used_amount >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (used_amount <= amount)
);
CREATE TABLE advance_application (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES branch(id),
  advance_id uuid NOT NULL REFERENCES customer_advance(id),
  invoice_id uuid NOT NULL REFERENCES sales_invoice(id),
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  vat_amount numeric(14,2) NOT NULL DEFAULT 0,
  journal_id uuid NOT NULL REFERENCES journal(id),
  applied_by uuid,
  applied_at timestamptz NOT NULL DEFAULT now()
);

-- ---------- daily cash closing (PY-03, FSD 5.6) ----------
CREATE TABLE cash_session (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES branch(id),
  cashier_id uuid NOT NULL REFERENCES app_user(id),
  session_date date NOT NULL,
  opening_float numeric(14,2) NOT NULL DEFAULT 0 CHECK (opening_float >= 0),
  cash_receipts numeric(14,2) NOT NULL,
  cash_refunds numeric(14,2) NOT NULL DEFAULT 0,
  handed_over numeric(14,2) NOT NULL DEFAULT 0 CHECK (handed_over >= 0),
  expected_cash numeric(14,2) NOT NULL,
  counted_cash numeric(14,2) NOT NULL CHECK (counted_cash >= 0),
  denominations jsonb NOT NULL DEFAULT '{}',
  card_expected numeric(14,2) NOT NULL DEFAULT 0,
  card_batch_total numeric(14,2),
  variance numeric(14,2) NOT NULL,
  note text,
  status text NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted','signed_off')),
  submitted_at timestamptz NOT NULL DEFAULT now(),
  signed_by uuid REFERENCES app_user(id),
  signed_at timestamptz,
  sign_note text,
  journal_id uuid REFERENCES journal(id),
  UNIQUE (branch_id, cashier_id, session_date)
);

-- ---------- car release (PY-04) ----------
CREATE TABLE credit_release (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES branch(id),
  job_card_id uuid NOT NULL REFERENCES job_card(id),
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  reason text NOT NULL,
  released_by uuid NOT NULL REFERENCES app_user(id),
  released_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE delivery ADD COLUMN balance_at_release numeric(14,2) NOT NULL DEFAULT 0, ADD COLUMN release_basis text;

-- ---------- counter sales and price lists (SL-01, SL-03) ----------
CREATE TABLE price_list_line (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  price_level text NOT NULL CHECK (price_level IN ('retail','trade','fleet')),
  item_id uuid NOT NULL REFERENCES item(id),
  price numeric(14,2) NOT NULL CHECK (price >= 0),
  min_price numeric(14,2) CHECK (min_price >= 0),
  valid_from date,
  valid_to date,
  active boolean NOT NULL DEFAULT true,
  CHECK (valid_to IS NULL OR valid_from IS NULL OR valid_to >= valid_from)
);
ALTER TABLE customer ADD COLUMN is_walk_in boolean NOT NULL DEFAULT false;
CREATE UNIQUE INDEX customer_one_walk_in ON customer (is_walk_in) WHERE is_walk_in;

-- ---------- row-level security ----------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['warranty_claim','credit_note','credit_note_line','customer_advance','advance_application','cash_session','credit_release'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY branch_scope ON %I USING (app_branch_ok(branch_id)) WITH CHECK (app_branch_ok(branch_id))', t);
  END LOOP;
END $$;
CREATE TRIGGER advance_application_append_only BEFORE UPDATE OR DELETE ON advance_application FOR EACH ROW EXECUTE FUNCTION forbid_change();
CREATE TRIGGER credit_release_append_only BEFORE UPDATE OR DELETE ON credit_release FOR EACH ROW EXECUTE FUNCTION forbid_change();

-- Counter sales leave the store as 'sale'; returned goods come back as 'return'.
ALTER TABLE stock_move DROP CONSTRAINT stock_move_move_type_check;
ALTER TABLE stock_move ADD CONSTRAINT stock_move_move_type_check
  CHECK (move_type IN ('opening','receipt','issue','return','adjustment','transfer_out','transfer_in','sale','warranty'));

-- Customer invoice link: resolves the unguessable share token to the invoice and its branch, so the
-- page can then read with that single branch in scope.
CREATE OR REPLACE FUNCTION invoice_by_token(p_token text)
RETURNS TABLE (id uuid, branch_id uuid) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id, branch_id FROM sales_invoice WHERE share_token = p_token AND length(p_token) >= 32
$$;

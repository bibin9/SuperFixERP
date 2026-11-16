-- 004 Billing and books slice (FSD phases 3-4, M11/M12): chart of accounts, account mapping,
-- balanced journals, tax invoices from job cards, receipts with allocation.

CREATE TABLE account (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  account_group text NOT NULL,
  account_type text NOT NULL CHECK (account_type IN ('asset','liability','equity','income','expense')),
  sub_type text NOT NULL DEFAULT 'normal' CHECK (sub_type IN ('cash','bank','receivable','payable','vat_output','vat_input','stock','normal')),
  active boolean NOT NULL DEFAULT true
);

-- Posting mapping (AC-02): business event -> ledger.
CREATE TABLE account_mapping (
  event_key text PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES account(id),
  description text
);

CREATE TABLE journal (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES branch(id),
  doc_no text NOT NULL UNIQUE,
  journal_date date NOT NULL,
  source_type text NOT NULL,
  source_id uuid,
  narration text,
  posted_at timestamptz NOT NULL DEFAULT now(),
  posted_by uuid
);

CREATE TABLE journal_line (
  id bigserial PRIMARY KEY,
  journal_id uuid NOT NULL REFERENCES journal(id),
  branch_id uuid NOT NULL REFERENCES branch(id),
  account_id uuid NOT NULL REFERENCES account(id),
  debit numeric(14,2) NOT NULL DEFAULT 0 CHECK (debit >= 0),
  credit numeric(14,2) NOT NULL DEFAULT 0 CHECK (credit >= 0),
  customer_id uuid REFERENCES customer(id),
  narration text,
  CHECK ((debit > 0) <> (credit > 0))
);
CREATE TRIGGER journal_append_only BEFORE UPDATE OR DELETE ON journal FOR EACH ROW EXECUTE FUNCTION forbid_change();
CREATE TRIGGER journal_line_append_only BEFORE UPDATE OR DELETE ON journal_line FOR EACH ROW EXECUTE FUNCTION forbid_change();

-- AC rule 2: each journal balances in total and per branch. Checked at commit.
CREATE OR REPLACE FUNCTION check_journal_balanced() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE bad record;
BEGIN
  SELECT branch_id, sum(debit) d, sum(credit) c INTO bad
  FROM journal_line WHERE journal_id = NEW.journal_id
  GROUP BY branch_id HAVING sum(debit) <> sum(credit) LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'Journal % does not balance for branch % (debit %, credit %)', NEW.journal_id, bad.branch_id, bad.d, bad.c;
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER journal_balanced AFTER INSERT ON journal_line
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_journal_balanced();

CREATE TABLE sales_invoice (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES branch(id),
  doc_no text NOT NULL UNIQUE,
  doc_date date NOT NULL,
  job_card_id uuid REFERENCES job_card(id),
  quotation_id uuid REFERENCES quotation(id),
  customer_id uuid NOT NULL REFERENCES customer(id),
  bill_to_name text NOT NULL,
  customer_trn char(15),
  lpo_no text,
  status text NOT NULL DEFAULT 'posted' CHECK (status IN ('posted')),
  taxable_total numeric(14,2) NOT NULL,
  vat_total numeric(14,2) NOT NULL,
  grand_total numeric(14,2) NOT NULL CHECK (grand_total >= 0),
  paid_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (paid_amount >= 0),
  due_date date NOT NULL,
  idempotency_key text NOT NULL UNIQUE,
  journal_id uuid NOT NULL REFERENCES journal(id),
  posted_at timestamptz NOT NULL DEFAULT now(),
  posted_by uuid,
  CHECK (paid_amount <= grand_total),
  CHECK (grand_total = taxable_total + vat_total)
);

CREATE TABLE sales_invoice_line (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES sales_invoice(id),
  branch_id uuid NOT NULL REFERENCES branch(id),
  job_line_id uuid REFERENCES job_line(id),
  line_no int NOT NULL,
  line_type text NOT NULL,
  description text NOT NULL,
  qty numeric(14,3) NOT NULL,
  unit_price numeric(14,2) NOT NULL,
  discount_amount numeric(14,2) NOT NULL,
  taxable_amount numeric(14,2) NOT NULL,
  vat_code text NOT NULL,
  vat_rate numeric(9,4) NOT NULL,
  vat_amount numeric(14,2) NOT NULL,
  line_total numeric(14,2) NOT NULL
);
-- IV-01 / leakage: a job line is billed at most once.
CREATE UNIQUE INDEX sales_invoice_line_job_line_uq ON sales_invoice_line (job_line_id) WHERE job_line_id IS NOT NULL;

CREATE TABLE receipt (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES branch(id),
  doc_no text NOT NULL UNIQUE,
  doc_date date NOT NULL,
  customer_id uuid NOT NULL REFERENCES customer(id),
  method text NOT NULL CHECK (method IN ('cash','card','bank_transfer','cheque')),
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  reference text,
  idempotency_key text NOT NULL UNIQUE,
  request_hash text NOT NULL,
  journal_id uuid NOT NULL REFERENCES journal(id),
  posted_at timestamptz NOT NULL DEFAULT now(),
  posted_by uuid
);

CREATE TABLE receipt_allocation (
  id bigserial PRIMARY KEY,
  receipt_id uuid NOT NULL REFERENCES receipt(id),
  invoice_id uuid NOT NULL REFERENCES sales_invoice(id),
  branch_id uuid NOT NULL REFERENCES branch(id),
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  at timestamptz NOT NULL DEFAULT now()
);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['journal','journal_line','sales_invoice','sales_invoice_line','receipt','receipt_allocation'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY branch_scope ON %I USING (app_branch_ok(branch_id)) WITH CHECK (app_branch_ok(branch_id))', t);
  END LOOP;
END $$;

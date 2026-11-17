-- 011 Accounting (FSD 4.12, phase 4): parties on ledger lines, manual vouchers, supplier payments and
-- cheques issued, bank accounts and reconciliation, card settlements, period close, head-office
-- allocation, fixed assets, budgets, opening balances and the Tally cut-over check.

-- Supplier as a party on ledger lines (payables ledger, AC-04).
ALTER TABLE journal_line ADD COLUMN supplier_id uuid REFERENCES supplier(id);
CREATE INDEX journal_line_supplier ON journal_line (supplier_id) WHERE supplier_id IS NOT NULL;
CREATE INDEX journal_line_customer ON journal_line (customer_id) WHERE customer_id IS NOT NULL;
CREATE INDEX journal_line_account ON journal_line (account_id);
CREATE INDEX journal_date_idx ON journal (journal_date);

-- Chart of accounts: Arabic name and "needs a party" flag (AC-01).
ALTER TABLE account ADD COLUMN name_ar text, ADD COLUMN party_type text CHECK (party_type IN ('customer','supplier'));

-- ---------- periods (AC-09) ----------
CREATE TABLE accounting_period (
  period_month date PRIMARY KEY CHECK (extract(day FROM period_month) = 1),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  checklist jsonb NOT NULL DEFAULT '{}',
  closed_by uuid, closed_at timestamptz,
  reopened_by uuid, reopened_at timestamptz, reopen_reason text,
  year_end_journal_id uuid
);
-- A closed month is locked for every user: nothing can be posted into it.
CREATE OR REPLACE FUNCTION journal_period_open() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM accounting_period WHERE period_month = date_trunc('month', NEW.journal_date)::date AND status = 'closed') THEN
    RAISE EXCEPTION 'The period % is closed. Post in an open month, or ask the owner to reopen it.', to_char(NEW.journal_date, 'Mon YYYY')
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER journal_period_lock BEFORE INSERT ON journal FOR EACH ROW EXECUTE FUNCTION journal_period_open();

-- ---------- manual vouchers (AC-03) ----------
CREATE TABLE voucher (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES branch(id),
  doc_no text UNIQUE,
  voucher_type text NOT NULL CHECK (voucher_type IN ('journal','payment','receipt','contra','debit_note','credit_note')),
  voucher_date date NOT NULL,
  narration text NOT NULL,
  total numeric(14,2) NOT NULL CHECK (total > 0),
  status text NOT NULL DEFAULT 'pending_approval' CHECK (status IN ('pending_approval','posted','rejected')),
  attachment_id uuid REFERENCES attachment(id),
  journal_id uuid REFERENCES journal(id),
  reject_reason text,
  created_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), posted_at timestamptz
);
CREATE TABLE voucher_line (
  id bigserial PRIMARY KEY,
  voucher_id uuid NOT NULL REFERENCES voucher(id),
  branch_id uuid NOT NULL REFERENCES branch(id),
  line_no int NOT NULL,
  account_id uuid NOT NULL REFERENCES account(id),
  debit numeric(14,2) NOT NULL DEFAULT 0 CHECK (debit >= 0),
  credit numeric(14,2) NOT NULL DEFAULT 0 CHECK (credit >= 0),
  customer_id uuid REFERENCES customer(id),
  supplier_id uuid REFERENCES supplier(id),
  narration text,
  CHECK ((debit > 0) <> (credit > 0))
);

-- ---------- bank accounts, cheques issued, card settlements, reconciliation (AC-05, AC-06, AC-17) ----------
CREATE TABLE bank_account (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  bank_name text NOT NULL,
  account_no text,
  iban text CHECK (iban IS NULL OR iban ~ '^AE[0-9]{21}$'),
  currency text NOT NULL DEFAULT 'AED',
  account_id uuid NOT NULL UNIQUE REFERENCES account(id),
  active boolean NOT NULL DEFAULT true
);

ALTER TABLE supplier_bill ADD COLUMN paid_amount numeric(14,2) NOT NULL DEFAULT 0, ADD CONSTRAINT supplier_bill_paid_ok CHECK (paid_amount >= 0 AND paid_amount <= grand_total);

CREATE TABLE supplier_payment (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES branch(id),
  doc_no text NOT NULL UNIQUE,
  doc_date date NOT NULL,
  supplier_id uuid NOT NULL REFERENCES supplier(id),
  method text NOT NULL CHECK (method IN ('bank_transfer','cheque','cash')),
  bank_account_id uuid REFERENCES bank_account(id),
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  on_account numeric(14,2) NOT NULL DEFAULT 0 CHECK (on_account >= 0),
  reference text,
  cheque_no text, cheque_date date,
  cheque_status text CHECK (cheque_status IN ('issued','cleared','cancelled')),
  cheque_event_at timestamptz, cheque_note text,
  idempotency_key text NOT NULL UNIQUE,
  journal_id uuid REFERENCES journal(id),
  posted_by uuid, posted_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE supplier_payment_allocation (
  id bigserial PRIMARY KEY,
  branch_id uuid NOT NULL REFERENCES branch(id),
  payment_id uuid NOT NULL REFERENCES supplier_payment(id),
  bill_id uuid REFERENCES supplier_bill(id),
  opening_item_id uuid,
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  reversed boolean NOT NULL DEFAULT false,
  at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE card_settlement (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES branch(id),
  doc_no text NOT NULL UNIQUE,
  settle_date date NOT NULL,
  bank_account_id uuid NOT NULL REFERENCES bank_account(id),
  batch_total numeric(14,2) NOT NULL CHECK (batch_total > 0),
  bank_credit numeric(14,2) NOT NULL CHECK (bank_credit > 0),
  commission numeric(14,2) NOT NULL CHECK (commission >= 0),
  reference text,
  journal_id uuid REFERENCES journal(id),
  created_by uuid, created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (batch_total = bank_credit + commission)
);

CREATE TABLE bank_statement (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_account_id uuid NOT NULL REFERENCES bank_account(id),
  file_name text NOT NULL,
  date_from date NOT NULL, date_to date NOT NULL,
  opening_balance numeric(14,2), closing_balance numeric(14,2),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','finished')),
  imported_by uuid, imported_at timestamptz NOT NULL DEFAULT now(),
  finished_by uuid, finished_at timestamptz
);
CREATE TABLE bank_statement_line (
  id bigserial PRIMARY KEY,
  statement_id uuid NOT NULL REFERENCES bank_statement(id),
  line_no int NOT NULL,
  line_date date NOT NULL,
  description text NOT NULL,
  reference text,
  amount numeric(14,2) NOT NULL CHECK (amount <> 0),
  journal_line_id bigint UNIQUE REFERENCES journal_line(id),
  match_kind text CHECK (match_kind IN ('auto','manual','created')),
  matched_by uuid, matched_at timestamptz
);

-- ---------- head-office allocation (AC-10) ----------
CREATE TABLE ho_allocation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  period_month date NOT NULL UNIQUE,
  basis text NOT NULL CHECK (basis IN ('revenue','fixed')),
  ho_cost numeric(14,2) NOT NULL,
  shares jsonb NOT NULL,
  journal_id uuid REFERENCES journal(id),
  posted_by uuid, posted_at timestamptz NOT NULL DEFAULT now()
);

-- ---------- fixed assets (AC-11) ----------
CREATE TABLE fixed_asset (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES branch(id),
  asset_no text NOT NULL UNIQUE,
  name text NOT NULL,
  category text NOT NULL,
  acquired_on date NOT NULL,
  cost numeric(14,2) NOT NULL CHECK (cost > 0),
  salvage numeric(14,2) NOT NULL DEFAULT 0 CHECK (salvage >= 0),
  life_months int NOT NULL CHECK (life_months > 0),
  depreciated numeric(14,2) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','disposed')),
  disposed_on date, disposal_amount numeric(14,2),
  journal_id uuid REFERENCES journal(id),
  created_by uuid, created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (salvage < cost), CHECK (depreciated <= cost - salvage)
);
CREATE TABLE depreciation_run (
  period_month date PRIMARY KEY,
  total numeric(14,2) NOT NULL,
  run_by uuid, run_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE depreciation_line (
  id bigserial PRIMARY KEY,
  period_month date NOT NULL REFERENCES depreciation_run(period_month),
  asset_id uuid NOT NULL REFERENCES fixed_asset(id),
  branch_id uuid NOT NULL REFERENCES branch(id),
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  journal_id uuid REFERENCES journal(id),
  UNIQUE (period_month, asset_id)
);

-- ---------- budgets (AC-12) ----------
CREATE TABLE budget (
  branch_id uuid NOT NULL REFERENCES branch(id),
  account_id uuid NOT NULL REFERENCES account(id),
  period_month date NOT NULL CHECK (extract(day FROM period_month) = 1),
  amount numeric(14,2) NOT NULL,
  PRIMARY KEY (branch_id, account_id, period_month)
);

-- ---------- opening balances and the Tally cut-over (TM-01 to TM-03) ----------
CREATE TABLE opening_item (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES branch(id),
  party_type text NOT NULL CHECK (party_type IN ('customer','supplier')),
  customer_id uuid REFERENCES customer(id),
  supplier_id uuid REFERENCES supplier(id),
  bill_no text NOT NULL,
  bill_date date NOT NULL,
  due_date date NOT NULL,
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  settled_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (settled_amount >= 0),
  batch_id uuid,
  CHECK (settled_amount <= amount),
  CHECK ((party_type = 'customer') = (customer_id IS NOT NULL) AND (party_type = 'supplier') = (supplier_id IS NOT NULL))
);
ALTER TABLE supplier_payment_allocation ADD CONSTRAINT spa_opening FOREIGN KEY (opening_item_id) REFERENCES opening_item(id);
ALTER TABLE supplier_payment_allocation ADD CONSTRAINT spa_target CHECK ((bill_id IS NULL) <> (opening_item_id IS NULL));
ALTER TABLE receipt_allocation ADD COLUMN opening_item_id uuid REFERENCES opening_item(id);
ALTER TABLE receipt_allocation ALTER COLUMN invoice_id DROP NOT NULL;
ALTER TABLE receipt_allocation ADD CONSTRAINT ra_target CHECK ((invoice_id IS NULL) <> (opening_item_id IS NULL));

CREATE TABLE migration_batch (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cutover_date date NOT NULL,
  status text NOT NULL DEFAULT 'loaded' CHECK (status IN ('loaded','signed_off')),
  ledger_rows int NOT NULL DEFAULT 0, bill_rows int NOT NULL DEFAULT 0,
  tally_tb jsonb,
  loaded_by uuid, loaded_at timestamptz NOT NULL DEFAULT now(),
  signed_by uuid, signed_at timestamptz, sign_note text
);
ALTER TABLE opening_item ADD CONSTRAINT oi_batch FOREIGN KEY (batch_id) REFERENCES migration_batch(id);

-- ---------- row security ----------
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['voucher','voucher_line','supplier_payment','supplier_payment_allocation','card_settlement','fixed_asset','depreciation_line','budget','opening_item'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY branch_scope ON %I USING (app_branch_ok(branch_id)) WITH CHECK (app_branch_ok(branch_id))', t);
  END LOOP;
END $$;

-- A receipt can settle an opening customer bill brought over from Tally.
ALTER TABLE receipt DROP CONSTRAINT receipt_kind_check, ADD CONSTRAINT receipt_kind_check CHECK (kind IN ('invoice','advance','opening'));

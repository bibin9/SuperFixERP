-- 026 Refund of customer money held (advances, overpayments, credit from returns) in cash, card or transfer.
-- A manager pays it out; the drawer count subtracts cash refunds. Append-only, branch-scoped.
CREATE TABLE customer_refund (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES branch(id),
  doc_no text NOT NULL UNIQUE,
  doc_date date NOT NULL,
  customer_id uuid NOT NULL REFERENCES customer(id),
  advance_id uuid NOT NULL REFERENCES customer_advance(id),
  method text NOT NULL REFERENCES payment_method(code),
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  vat_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (vat_amount >= 0),
  reference text,
  reason text NOT NULL,
  idempotency_key text NOT NULL UNIQUE,
  request_hash text NOT NULL,
  journal_id uuid NOT NULL REFERENCES journal(id),
  paid_by uuid NOT NULL,
  paid_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX customer_refund_cashier ON customer_refund (branch_id, paid_by, doc_date);
ALTER TABLE customer_refund ENABLE ROW LEVEL SECURITY;
CREATE POLICY branch_scope ON customer_refund USING (app_branch_ok(branch_id)) WITH CHECK (app_branch_ok(branch_id));
CREATE TRIGGER customer_refund_append_only BEFORE UPDATE OR DELETE ON customer_refund FOR EACH ROW EXECUTE FUNCTION forbid_change();

INSERT INTO doc_series (branch_id, doc_type, prefix, next_number, padding, year_part)
SELECT b.id, 'refund', b.code || '-RF-', 1, 6, true FROM branch b
ON CONFLICT (branch_id, doc_type) DO NOTHING;

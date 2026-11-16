-- 003 Stock engine slice (FSD phase 2, M06/M07): items, stock balances at weighted average cost,
-- the stock ledger, parts commitment to job lines and issue to job.

CREATE TABLE item (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  part_no text NOT NULL UNIQUE,
  description text NOT NULL,
  name_ar text,
  brand text,
  category text NOT NULL DEFAULT 'parts',
  uom text NOT NULL DEFAULT 'EA',
  list_price numeric(14,2) NOT NULL DEFAULT 0 CHECK (list_price >= 0),
  vat_code text NOT NULL DEFAULT 'SR' REFERENCES tax_code(code),
  item_type text NOT NULL DEFAULT 'stock' CHECK (item_type IN ('stock','non_stock','service','consumable')),
  preferred_supplier text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  version int NOT NULL DEFAULT 1
);
ALTER TABLE job_line ADD CONSTRAINT job_line_item_fk FOREIGN KEY (item_id) REFERENCES item(id);
ALTER TABLE job_line ADD COLUMN issued_qty numeric(14,3) NOT NULL DEFAULT 0 CHECK (issued_qty >= 0);

CREATE TABLE item_branch (
  item_id uuid NOT NULL REFERENCES item(id),
  branch_id uuid NOT NULL REFERENCES branch(id),
  reorder_level numeric(14,3) NOT NULL DEFAULT 0,
  reorder_qty numeric(14,3) NOT NULL DEFAULT 0,
  default_bin text,
  PRIMARY KEY (item_id, branch_id)
);

-- free = on_hand - committed - reserved (FSD 5.3). Negative stock is not allowed (IN-05).
CREATE TABLE stock_balance (
  item_id uuid NOT NULL REFERENCES item(id),
  branch_id uuid NOT NULL REFERENCES branch(id),
  on_hand numeric(14,3) NOT NULL DEFAULT 0 CHECK (on_hand >= 0),
  committed numeric(14,3) NOT NULL DEFAULT 0 CHECK (committed >= 0),
  reserved numeric(14,3) NOT NULL DEFAULT 0 CHECK (reserved >= 0),
  avg_cost numeric(14,4) NOT NULL DEFAULT 0 CHECK (avg_cost >= 0),
  last_move_at timestamptz,
  PRIMARY KEY (item_id, branch_id),
  CHECK (committed + reserved <= on_hand)
);

-- The stock ledger (IN-11). Append-only.
CREATE TABLE stock_move (
  id bigserial PRIMARY KEY,
  branch_id uuid NOT NULL REFERENCES branch(id),
  item_id uuid NOT NULL REFERENCES item(id),
  at timestamptz NOT NULL DEFAULT now(),
  move_type text NOT NULL CHECK (move_type IN ('opening','receipt','issue','return','adjustment','transfer_out','transfer_in')),
  doc_ref text NOT NULL,
  job_line_id uuid REFERENCES job_line(id),
  qty_in numeric(14,3) NOT NULL DEFAULT 0 CHECK (qty_in >= 0),
  qty_out numeric(14,3) NOT NULL DEFAULT 0 CHECK (qty_out >= 0),
  unit_cost numeric(14,4) NOT NULL CHECK (unit_cost >= 0),
  value numeric(14,2) NOT NULL,
  balance_qty numeric(14,3) NOT NULL,
  balance_avg_cost numeric(14,4) NOT NULL,
  user_id uuid,
  CHECK ((qty_in > 0) <> (qty_out > 0))
);
CREATE TRIGGER stock_move_append_only BEFORE UPDATE OR DELETE ON stock_move FOR EACH ROW EXECUTE FUNCTION forbid_change();

CREATE TABLE stock_commitment (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES branch(id),
  item_id uuid NOT NULL REFERENCES item(id),
  job_line_id uuid NOT NULL REFERENCES job_line(id),
  qty numeric(14,3) NOT NULL CHECK (qty >= 0),            -- committed from free stock
  back_ordered numeric(14,3) NOT NULL DEFAULT 0 CHECK (back_ordered >= 0),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','released','issued')),
  created_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  CHECK (status <> 'active' OR qty > 0 OR back_ordered > 0)
);
CREATE UNIQUE INDEX stock_commitment_one_active ON stock_commitment (job_line_id) WHERE status = 'active';

ALTER TABLE stock_move ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_commitment ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_balance ENABLE ROW LEVEL SECURITY;
CREATE POLICY branch_scope ON stock_move USING (app_branch_ok(branch_id)) WITH CHECK (app_branch_ok(branch_id));
CREATE POLICY branch_scope ON stock_commitment USING (app_branch_ok(branch_id)) WITH CHECK (app_branch_ok(branch_id));
-- BR-03: quantities at every branch are readable by every signed-in user; cost is removed by the
-- field-permission layer. Writes stay inside the user's branches.
CREATE POLICY read_all_branches ON stock_balance FOR SELECT USING (app_user_id() IS NOT NULL);
CREATE POLICY write_own_branch ON stock_balance FOR INSERT WITH CHECK (app_branch_ok(branch_id));
CREATE POLICY update_own_branch ON stock_balance FOR UPDATE USING (app_branch_ok(branch_id)) WITH CHECK (app_branch_ok(branch_id));

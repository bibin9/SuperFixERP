-- 041 IN-03: tyres by size, brand, load and speed index and DOT (week and year made); batteries and
-- tyres by warranty serial. The DOT is entered when tyres are received and the oldest is used first.
ALTER TABLE item ADD COLUMN tyre_size text, ADD COLUMN load_index text, ADD COLUMN speed_index text, ADD COLUMN warranty_months int CHECK (warranty_months BETWEEN 0 AND 120);
ALTER TABLE grn_line ADD COLUMN dot_code text CHECK (dot_code ~ '^[0-9]{4}$');
CREATE TABLE tyre_dot_stock (
  branch_id uuid NOT NULL REFERENCES branch(id),
  item_id uuid NOT NULL REFERENCES item(id),
  dot_code text NOT NULL CHECK (dot_code ~ '^[0-9]{4}$'),
  qty numeric(14,3) NOT NULL CHECK (qty >= 0),
  PRIMARY KEY (branch_id, item_id, dot_code)
);
ALTER TABLE tyre_dot_stock ENABLE ROW LEVEL SECURITY;
CREATE POLICY branch_scope ON tyre_dot_stock USING (app_branch_ok(branch_id)) WITH CHECK (app_branch_ok(branch_id));
CREATE TABLE part_serial (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES branch(id),
  item_id uuid NOT NULL REFERENCES item(id),
  serial_no text NOT NULL CHECK (btrim(serial_no) <> ''),
  job_card_id uuid REFERENCES job_card(id),
  job_line_id uuid REFERENCES job_line(id),
  customer_id uuid REFERENCES customer(id),
  vehicle_id uuid REFERENCES vehicle(id),
  fitted_on date NOT NULL DEFAULT current_date,
  warranty_until date,
  created_by uuid, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX part_serial_key ON part_serial (item_id, upper(btrim(serial_no)));
ALTER TABLE part_serial ENABLE ROW LEVEL SECURITY;
CREATE POLICY branch_scope ON part_serial USING (app_branch_ok(branch_id)) WITH CHECK (app_branch_ok(branch_id));
INSERT INTO setting (key, value, grp, description)
SELECT 'tyres.max_age_years', '3', 'Stock', 'Tyres older than this many years (from their DOT) are flagged on the tyre stock page'
WHERE NOT EXISTS (SELECT 1 FROM setting WHERE key = 'tyres.max_age_years' AND branch_id IS NULL);
INSERT INTO setting (key, value, grp, description)
SELECT 'tyres.dot_required', 'false', 'Stock', 'The store must enter the DOT (week and year made) when receiving tyres'
WHERE NOT EXISTS (SELECT 1 FROM setting WHERE key = 'tyres.dot_required' AND branch_id IS NULL);

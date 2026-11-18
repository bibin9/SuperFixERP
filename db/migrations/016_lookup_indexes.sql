-- 016 Lookup indexes (Codex QA report, PERF-SQL-01).
-- The customer list counts each customer's vehicles; without an index on vehicle.owner_customer_id that count
-- read the whole vehicle table once per customer. The same applies to the other "records of this customer /
-- job / item" lookups below, which customer, job, stock and receipt screens make on every open.
CREATE INDEX IF NOT EXISTS vehicle_owner_idx      ON vehicle (owner_customer_id);
CREATE INDEX IF NOT EXISTS customer_active_new_idx ON customer (created_at DESC) WHERE active;
CREATE INDEX IF NOT EXISTS enquiry_customer_idx   ON enquiry (customer_id);
CREATE INDEX IF NOT EXISTS enquiry_vehicle_idx    ON enquiry (vehicle_id);
CREATE INDEX IF NOT EXISTS job_card_customer_idx  ON job_card (customer_id);
CREATE INDEX IF NOT EXISTS quotation_job_idx      ON quotation (job_card_id);
CREATE INDEX IF NOT EXISTS job_line_item_idx      ON job_line (item_id);
CREATE INDEX IF NOT EXISTS stock_move_item_idx    ON stock_move (item_id);
CREATE INDEX IF NOT EXISTS receipt_customer_idx   ON receipt (customer_id);
CREATE INDEX IF NOT EXISTS receipt_job_idx        ON receipt (job_card_id);

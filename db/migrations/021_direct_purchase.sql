-- 021 Buy a part for one job (demo "Buy for a job", PU-03): bought from a local shop with petty cash,
-- it never goes into stock. Its cost goes to work in progress for that job line, and moves to cost of
-- sales when the job is invoiced (or to warranty expense for warranty lines), like an issued part.
ALTER TABLE petty_cash_entry ADD COLUMN job_card_id uuid REFERENCES job_card(id), ADD COLUMN job_line_id uuid REFERENCES job_line(id);
ALTER TABLE job_line ADD COLUMN direct_cost numeric(14,2) NOT NULL DEFAULT 0 CHECK (direct_cost >= 0);
CREATE INDEX petty_cash_entry_job_idx ON petty_cash_entry (job_card_id) WHERE job_card_id IS NOT NULL;

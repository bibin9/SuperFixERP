-- 028 Combined invoice: one tax invoice for several finished job cards of the same customer (fleet
-- month-end billing). The invoice has no single job card; each job on it is listed here with its share.
-- 027 named an index sales_invoice_job; the name is needed for the table, so the index is renamed.
ALTER INDEX IF EXISTS sales_invoice_job RENAME TO sales_invoice_job_card_idx;
ALTER TABLE sales_invoice DROP CONSTRAINT IF EXISTS sales_invoice_source_check;
ALTER TABLE sales_invoice ADD CONSTRAINT sales_invoice_source_check CHECK (source IN ('job','counter','combined'));
CREATE TABLE sales_invoice_job (
  invoice_id uuid NOT NULL REFERENCES sales_invoice(id),
  job_card_id uuid NOT NULL REFERENCES job_card(id),
  branch_id uuid NOT NULL REFERENCES branch(id),
  taxable_total numeric(14,2) NOT NULL,
  vat_total numeric(14,2) NOT NULL,
  grand_total numeric(14,2) NOT NULL,
  PRIMARY KEY (invoice_id, job_card_id)
);
CREATE INDEX sales_invoice_job_job ON sales_invoice_job (job_card_id);
ALTER TABLE sales_invoice_job ENABLE ROW LEVEL SECURITY;
CREATE POLICY branch_scope ON sales_invoice_job USING (app_branch_ok(branch_id)) WITH CHECK (app_branch_ok(branch_id));
CREATE TRIGGER sales_invoice_job_append_only BEFORE UPDATE OR DELETE ON sales_invoice_job FOR EACH ROW EXECUTE FUNCTION forbid_change();

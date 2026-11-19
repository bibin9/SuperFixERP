-- 027 Indexes for the dashboards and reports (the reports dashboard took 7-8 s on UAT data).
-- Every branch-and-period figure filters by branch and a date; joins follow job card and enquiry links.
CREATE INDEX IF NOT EXISTS sales_invoice_branch_date ON sales_invoice (branch_id, doc_date);
CREATE INDEX IF NOT EXISTS sales_invoice_job ON sales_invoice (job_card_id);
CREATE INDEX IF NOT EXISTS sales_invoice_customer ON sales_invoice (customer_id, doc_date);
CREATE INDEX IF NOT EXISTS receipt_branch_date ON receipt (branch_id, doc_date);
CREATE INDEX IF NOT EXISTS receipt_allocation_invoice ON receipt_allocation (invoice_id);
CREATE INDEX IF NOT EXISTS job_card_branch_status ON job_card (branch_id, status);
CREATE INDEX IF NOT EXISTS job_card_branch_created ON job_card (branch_id, created_at);
CREATE INDEX IF NOT EXISTS job_card_branch_docdate ON job_card (branch_id, doc_date);
CREATE INDEX IF NOT EXISTS job_card_branch_delivered ON job_card (branch_id, delivered_at) WHERE delivered_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS enquiry_branch_date ON enquiry (branch_id, doc_date);
CREATE INDEX IF NOT EXISTS enquiry_converted_job ON enquiry (converted_job_id) WHERE converted_job_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS message_log_enquiry ON message_log (enquiry_id) WHERE enquiry_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS message_log_job ON message_log (job_card_id) WHERE job_card_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS time_event_job ON time_event (job_card_id, at);
CREATE INDEX IF NOT EXISTS time_event_branch_at ON time_event (branch_id, at);
CREATE INDEX IF NOT EXISTS job_line_job ON job_line (job_card_id);
CREATE INDEX IF NOT EXISTS journal_line_journal ON journal_line (journal_id);
CREATE INDEX IF NOT EXISTS journal_source ON journal (source_type, source_id);
CREATE INDEX IF NOT EXISTS stock_move_branch_item ON stock_move (branch_id, item_id);
CREATE INDEX IF NOT EXISTS credit_note_invoice ON credit_note (invoice_id);
CREATE INDEX IF NOT EXISTS advance_application_advance ON advance_application (advance_id);
CREATE INDEX IF NOT EXISTS customer_advance_customer ON customer_advance (customer_id);
ANALYZE sales_invoice; ANALYZE receipt; ANALYZE job_card; ANALYZE enquiry; ANALYZE time_event; ANALYZE journal_line;

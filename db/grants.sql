-- Re-applied after every migration run. The application role never owns tables, so row
-- security applies to it, and it can never update or delete append-only ledgers.
GRANT USAGE ON SCHEMA public TO superfix_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO superfix_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO superfix_app;
REVOKE UPDATE, DELETE ON audit_log, login_event, approval_action, consent_log, stock_move, journal, journal_line FROM superfix_app;
REVOKE UPDATE, DELETE ON sales_invoice_line FROM superfix_app;
REVOKE DELETE ON sales_invoice, receipt, receipt_allocation, quotation, quotation_line, job_card, job_line, customer, vehicle FROM superfix_app;
REVOKE ALL ON schema_migrations FROM superfix_app;

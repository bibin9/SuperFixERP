-- 013 Fixes from Superfix's review on 17 Nov 2026.

-- 1. Voucher numbering: each voucher type has its own series per branch (as in Tally), editable
--    under Document numbering. Existing VCH numbers stay as they are.
INSERT INTO doc_series (branch_id, doc_type, prefix, next_number, padding, year_part)
SELECT b.id, t.doc_type, b.code || t.suffix, 1, 5, true FROM branch b
CROSS JOIN (VALUES ('voucher_journal','-JRN-'),('voucher_payment','-PMT-'),('voucher_receipt','-RCV-'),('voucher_contra','-CON-'),
                   ('voucher_debit_note','-DBN-'),('voucher_credit_note','-CRN-')) t(doc_type, suffix)
ON CONFLICT (branch_id, doc_type) DO NOTHING;

-- 2. Audit log is its own screen in the permission matrix (view, export), so the admin decides who sees it.
INSERT INTO permission (role_id, screen, action)
SELECT r.id, x.screen, x.action FROM role r JOIN (VALUES ('owner','audit','view'),('owner','audit','export'),('accountant','audit','view')) x(role, screen, action) ON x.role = r.code
ON CONFLICT DO NOTHING;

-- 3. Price levels are a pick list (master form), not fixed values.
ALTER TABLE customer DROP CONSTRAINT IF EXISTS customer_price_level_check;
ALTER TABLE price_list_line DROP CONSTRAINT IF EXISTS price_list_line_price_level_check;
INSERT INTO lookup_value (list, code, name_en, sort) VALUES
 ('price_level','retail','Retail',1),('price_level','trade','Trade',2),('price_level','fleet','Fleet',3)
ON CONFLICT (list, code) DO NOTHING;

-- 4. E-invoicing details of the buyer (PINT AE): Peppol participant ID, trade licence, structured address and contact.
ALTER TABLE customer
  ADD COLUMN peppol_id text CHECK (peppol_id IS NULL OR peppol_id ~ '^[0-9]{4}:[A-Za-z0-9.\-]{1,50}$'),
  ADD COLUMN trade_licence_no text,
  ADD COLUMN licence_authority text,
  ADD COLUMN building_street text,
  ADD COLUMN city text,
  ADD COLUMN emirate text,
  ADD COLUMN po_box text,
  ADD COLUMN contact_person text,
  ADD COLUMN contact_phone text;
INSERT INTO lookup_value (list, code, name_en, sort) VALUES
 ('licence_authority','ad_ded','Abu Dhabi Department of Economic Development',1),('licence_authority','dubai_det','Dubai Department of Economy and Tourism',2),
 ('licence_authority','sharjah_sedd','Sharjah Economic Development Department',3),('licence_authority','free_zone','Free zone authority',4),('licence_authority','other','Other',9),
 ('emirate','abu_dhabi','Abu Dhabi',1),('emirate','dubai','Dubai',2),('emirate','sharjah','Sharjah',3),('emirate','ajman','Ajman',4),
 ('emirate','umm_al_quwain','Umm Al Quwain',5),('emirate','ras_al_khaimah','Ras Al Khaimah',6),('emirate','fujairah','Fujairah',7)
ON CONFLICT (list, code) DO NOTHING;
INSERT INTO setting (key, value, grp, description)
SELECT 'einvoice.require_buyer_details', 'true', 'Billing', 'A VAT-registered company or government customer needs the Peppol ID, trade licence, city and emirate before a tax invoice is posted'
WHERE NOT EXISTS (SELECT 1 FROM setting WHERE key = 'einvoice.require_buyer_details');
UPDATE workflow SET name = 'Transfer order between branches' WHERE doc_type = 'stock_transfer';

-- 5. Audit entries keep the role the user acted in, so a transaction's history shows who did what and as what.
ALTER TABLE audit_log ADD COLUMN role_name text;
CREATE INDEX audit_log_user_idx ON audit_log (user_id, at DESC);

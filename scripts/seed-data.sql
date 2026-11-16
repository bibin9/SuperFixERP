-- Reference and master data for local testing. Synthetic names, numbers and TRNs only.
INSERT INTO company (legal_name_en, legal_name_ar, trade_licence_no, trn, address)
VALUES ('Super Fix Auto Centers', 'سوبر فكس لصيانة السيارات', 'CN-0000000', '100000000000003', 'Abu Dhabi, UAE');

INSERT INTO branch (code, name_en, branch_type, emirate, phone, whatsapp_number) VALUES
 ('HQ','Head Office','head_office','Abu Dhabi','+97120000000',NULL),
 ('KHA','Al Khaleej Al Arabi','workshop','Abu Dhabi','+97120000001','+971500000001'),
 ('YAS','Yas','workshop','Abu Dhabi','+97120000002','+971500000002'),
 ('YSS','Yas South','workshop','Abu Dhabi','+97120000003','+971500000003'),
 ('BHY','Al Bahyah','workshop','Abu Dhabi','+97120000004','+971500000004'),
 ('BNY','Baniyas','workshop','Abu Dhabi','+97120000005','+971500000005'),
 ('SM1','Samha 1','workshop','Abu Dhabi','+97120000006','+971500000006'),
 ('SM2','Samha 2','workshop','Abu Dhabi','+97120000007','+971500000007'),
 ('HIL','Al Hili','workshop','Abu Dhabi','+97130000008','+971500000008'),
 ('ZKH','ADNOC Zakher','workshop','Abu Dhabi','+97130000009','+971500000009'),
 ('MZD','Mezyad','workshop','Abu Dhabi','+97130000010','+971500000010'),
 ('UGF','Um Ghafah','workshop','Abu Dhabi','+97130000011','+971500000011'),
 ('SHM','Shabiya Al Maqam','workshop','Abu Dhabi','+97130000012','+971500000012'),
 ('AFY','Ain Al Fayidah','workshop','Abu Dhabi','+97130000013','+971500000013'),
 ('MTR','ADNOC Al Matar','workshop','Sharjah','+97160000014','+971500000014'),
 ('MHK','Mahaskar','workshop','Sharjah','+97160000015','+971500000015'),
 ('QUS','Al Qusais','workshop','Dubai','+97140000016','+971500000016'),
 ('DYF','Al Deyafa','workshop','Ajman','+97160000017','+971500000017');

INSERT INTO bay (branch_id, code, bay_type)
SELECT b.id, 'B' || g, CASE WHEN g = 1 THEN 'alignment' WHEN g = 2 THEN 'tyre' ELSE 'lift' END
FROM branch b CROSS JOIN generate_series(1,5) g WHERE b.branch_type = 'workshop';

-- Document series (FSD 3.4). Job cards continue from the prototype's running numbers.
INSERT INTO doc_series (branch_id, doc_type, prefix, next_number, padding, year_part)
SELECT b.id, t.doc_type, b.code || t.suffix,
       CASE WHEN t.doc_type = 'job_card' THEN coalesce(n.next, 1) ELSE 1 END, t.padding, t.year_part
FROM branch b
CROSS JOIN (VALUES ('job_card','-',4,false),('enquiry','-ENQ-',5,true),('invoice','-INV-',6,true),('receipt','-RC-',6,true),('credit_note','-CN-',6,true),('journal','-JV-',6,true)) t(doc_type, suffix, padding, year_part)
LEFT JOIN (VALUES ('KHA',2214),('YAS',1483),('YSS',412),('BHY',1088),('BNY',1651),('SM1',977),('SM2',705),('HIL',1302),('ZKH',864),('MZD',599),('UGF',521),('SHM',743),('AFY',468),('MTR',1190),('MHK',836),('QUS',731),('DYF',655)) n(code, next) ON n.code = b.code;

-- Roles (BRD section 6) and the starting permission matrix (FSD 3.2).
INSERT INTO role (code, name, home_screen, is_admin) VALUES
 ('admin','Administrator','admin',true),
 ('owner','Owner / HQ','dashboard',false),
 ('branch_manager','Branch manager','dashboard',false),
 ('advisor','Service advisor','jobs',false),
 ('foreman','Foreman','jobs',false),
 ('technician','Technician','my-jobs',false),
 ('stock_keeper','Stock keeper','stock',false),
 ('purchasing','Purchasing officer','stock',false),
 ('accountant','Accountant','invoices',false),
 ('hr_payroll','HR / payroll','home',false);

WITH m(role, screen, actions) AS (VALUES
 ('owner','customers','view,create,edit,approve,cancel,export'), ('owner','jobs','view,create,edit,approve,cancel,export'),
 ('owner','workshop','view,create,edit,approve,cancel,export'), ('owner','stock','view,create,edit,approve,cancel,export'),
 ('owner','purchasing','view,create,edit,approve,cancel,export'), ('owner','invoices','view,create,edit,approve,cancel,export'),
 ('owner','accounting','view,create,edit,approve,cancel,export'), ('owner','hr','view,create,edit,approve,cancel,export'),
 ('owner','settings','view,edit'), ('owner','approvals','view,approve'), ('owner','reports','view,export'), ('owner','admin','view'),
 ('branch_manager','customers','view,create,edit,export'), ('branch_manager','jobs','view,create,edit,approve,cancel,export'),
 ('branch_manager','workshop','view,edit'), ('branch_manager','stock','view,create,edit,approve'), ('branch_manager','purchasing','view,create,approve'),
 ('branch_manager','invoices','view,create,approve,cancel'), ('branch_manager','accounting','view'), ('branch_manager','hr','view,approve'),
 ('branch_manager','approvals','view,approve'), ('branch_manager','reports','view,export'),
 ('advisor','customers','view,create,edit'), ('advisor','jobs','view,create,edit'), ('advisor','workshop','view'), ('advisor','stock','view'),
 ('advisor','invoices','view,create'), ('advisor','approvals','view'), ('advisor','reports','view'),
 ('foreman','customers','view'), ('foreman','jobs','view,edit'), ('foreman','workshop','view,edit'), ('foreman','stock','view'), ('foreman','approvals','view'),
 ('technician','workshop','view'),
 ('stock_keeper','customers','view'), ('stock_keeper','jobs','view'), ('stock_keeper','workshop','view'), ('stock_keeper','stock','view,create,edit,cancel,export'),
 ('stock_keeper','purchasing','view,create'), ('stock_keeper','approvals','view'),
 ('purchasing','jobs','view'), ('purchasing','stock','view'), ('purchasing','purchasing','view,create,edit,cancel,export'), ('purchasing','approvals','view'),
 ('accountant','customers','view'), ('accountant','jobs','view'), ('accountant','stock','view'), ('accountant','purchasing','view,edit'),
 ('accountant','invoices','view,create,edit,approve,cancel,export'), ('accountant','accounting','view,create,edit,approve,cancel,export'),
 ('accountant','hr','view'), ('accountant','settings','view,edit'), ('accountant','approvals','view,approve'), ('accountant','reports','view,export'),
 ('hr_payroll','hr','view,create,edit,approve,cancel,export'), ('hr_payroll','settings','view'), ('hr_payroll','approvals','view,approve')
)
INSERT INTO permission (role_id, screen, action)
SELECT r.id, m.screen, a FROM m JOIN role r ON r.code = m.role CROSS JOIN LATERAL unnest(string_to_array(m.actions, ',')) a;

-- Sensitive field register (FSD 3.3)
INSERT INTO field_group (code, name, fields, derived) VALUES
 ('purchase_cost','Purchase cost','Item cost, last purchase price, weighted average cost, supplier price, landed cost, PO and bill amounts, transfer value','Margin, margin %, gross profit, stock value, job cost'),
 ('margin','Margin and profit','Line margin, job profit, branch P&L',NULL),
 ('selling_price','Selling price','List price, price-level price','Line amounts on quotations for technicians'),
 ('discount','Discount','Discount % and amount',NULL),
 ('salary','Salary','Every salary component, gross, net, gratuity, leave salary, loan balance','Payroll cost, labour cost on a job'),
 ('bank_balance','Bank balances','Bank and cash ledger balances','Cash position on dashboards');

WITH f(role, grp, lvl) AS (VALUES
 ('owner','purchase_cost','view'),('owner','margin','view'),('owner','selling_price','edit'),('owner','discount','edit'),('owner','salary','view'),('owner','bank_balance','view'),
 ('branch_manager','purchase_cost','view'),('branch_manager','margin','view'),('branch_manager','selling_price','edit'),('branch_manager','discount','edit'),('branch_manager','salary','hidden'),('branch_manager','bank_balance','hidden'),
 ('advisor','purchase_cost','hidden'),('advisor','margin','hidden'),('advisor','selling_price','view'),('advisor','discount','edit'),('advisor','salary','hidden'),('advisor','bank_balance','hidden'),
 ('foreman','purchase_cost','hidden'),('foreman','margin','hidden'),('foreman','selling_price','view'),('foreman','discount','hidden'),('foreman','salary','hidden'),('foreman','bank_balance','hidden'),
 ('technician','purchase_cost','hidden'),('technician','margin','hidden'),('technician','selling_price','hidden'),('technician','discount','hidden'),('technician','salary','hidden'),('technician','bank_balance','hidden'),
 ('stock_keeper','purchase_cost','view'),('stock_keeper','margin','hidden'),('stock_keeper','selling_price','view'),('stock_keeper','discount','hidden'),('stock_keeper','salary','hidden'),('stock_keeper','bank_balance','hidden'),
 ('purchasing','purchase_cost','edit'),('purchasing','margin','hidden'),('purchasing','selling_price','view'),('purchasing','discount','hidden'),('purchasing','salary','hidden'),('purchasing','bank_balance','hidden'),
 ('accountant','purchase_cost','view'),('accountant','margin','view'),('accountant','selling_price','view'),('accountant','discount','view'),('accountant','salary','hidden'),('accountant','bank_balance','view'),
 ('hr_payroll','purchase_cost','hidden'),('hr_payroll','margin','hidden'),('hr_payroll','selling_price','hidden'),('hr_payroll','discount','hidden'),('hr_payroll','salary','edit'),('hr_payroll','bank_balance','hidden')
)
INSERT INTO field_permission (role_id, field_group, level) SELECT r.id, f.grp, f.lvl FROM f JOIN role r ON r.code = f.role;

-- Settings (every threshold is data, BRD 7.14). Payroll, WPS and gateway values are placeholders until Q2/Q4/Q5 are answered.
INSERT INTO setting (key, value, grp, description) VALUES
 ('security.max_failed_logins','5','Security','Failed sign-ins before lock-out'),
 ('security.lockout_minutes','15','Security','Lock-out length in minutes'),
 ('security.session_idle_minutes','30','Security','Session ends after this many idle minutes'),
 ('discount.max_pct.advisor','10','Discounts','Max discount % an advisor can give without approval (per line and per document)'),
 ('discount.max_pct.foreman','0','Discounts','Max discount % for a foreman'),
 ('discount.max_pct.branch_manager','25','Discounts','Max discount % for a branch manager'),
 ('discount.max_pct.owner','100','Discounts','Max discount % for the owner'),
 ('pricing.min_margin_pct','10','Pricing','Minimum margin %; below it a price needs manager approval (FP-05)'),
 ('tax.default_code','"SR"','Tax','Tax code used for outside work and any line whose master has none'),
 ('quotation.validity_days','7','Quotations','Default quotation validity in days'),
 ('quotation.deferred_follow_up_days','30','Quotations','Follow-up date for declined (deferred) work'),
 ('quick_invoice.limit','500','Quick invoice','Max total for a quick invoice job, AED (Q6 default)'),
 ('workshop.amber_pct','85','Workshop','Line turns amber at this % of standard time'),
 ('workshop.job_warning_minutes','30','Workshop','Job turns amber this many minutes before promised time'),
 ('workshop.planning_factor','1.2','Workshop','Promised time planning factor'),
 ('photos.keep_days_after_close','0','Attachments','Job photos kept this many days after the job closes (Q12 default)'),
 ('archive.live_months','12','Archive','Live window before archiving (Q12 default)'),
 ('ontime.measured_at','"ready"','Workshop','On-time measured at ready or delivered (Q7 default)'),
 ('cash.variance_tolerance','5','Cash','Cash closing variance tolerance, AED'),
 ('payments.gateway','"manual"','Integrations','Payment link provider (manual only: staff record payments, no gateway is called)'),
 ('wps.agent_routing_code','""','Payroll','WPS agent routing code (Q4 open)'),
 ('wps.employer_mohre_id','""','Payroll','13-digit MOHRE establishment ID (Q4 open)'),
 ('payroll.daily_wage_divisor','30','Payroll','Daily wage = monthly / this (Q5 default)'),
 ('payroll.overtime_normal_multiplier','1.25','Payroll','Normal overtime multiplier'),
 ('payroll.overtime_night_multiplier','1.5','Payroll','Overtime 22:00-04:00 multiplier'),
 ('payroll.deduction_cap_pct','50','Payroll','Max total deductions as % of wage'),
 ('payroll.leave_salary_components','["basic","housing"]','Payroll','Components counted for leave salary (Q5 default)');

-- Countries (CV-02) and plate set-up (CV-11)
INSERT INTO country (code, name, dial_code, mobile_regex, id_types) VALUES
 ('AE','United Arab Emirates','971','^(5[0-9]{8}|[2-9][0-9]{7})$','{"Emirates ID","Passport"}'),
 ('SA','Saudi Arabia','966','^5[0-9]{8}$','{"National ID","Iqama","Passport"}'),
 ('OM','Oman','968','^[79][0-9]{7}$','{"National ID","Passport"}'),
 ('QA','Qatar','974','^[3567][0-9]{7}$','{"National ID","Passport"}'),
 ('BH','Bahrain','973','^[36][0-9]{7}$','{"National ID","Passport"}'),
 ('KW','Kuwait','965','^[569][0-9]{7}$','{"National ID","Passport"}');

INSERT INTO plate_template (code, name, country_code, code_label, code_values, number_regex) VALUES
 ('AUH','Abu Dhabi','AE','Code','{1,2,4,5,6,7,8,9,10,11,12,13,14,15,16,17,50}','^[0-9]{1,5}$'),
 ('DXB','Dubai','AE','Code','{A,B,C,D,E,F,G,H,I,J,K,L,M,N,O,P,Q,R,S,T,U,V,W,X,Y,Z,AA,BB,CC,DD}','^[0-9]{1,5}$'),
 ('SHJ','Sharjah','AE','Code','{1,2,3,4,5}','^[0-9]{1,5}$'),
 ('AJM','Ajman','AE','Code','{A,B,C,D,E,H,K}','^[0-9]{1,5}$'),
 ('UAQ','Umm Al Quwain','AE','Code','{A,B,C,D,E,F,G,H,I,X}','^[0-9]{1,5}$'),
 ('RAK','Ras Al Khaimah','AE','Code','{A,B,C,D,I,K,M,N,S,V,Y}','^[0-9]{1,5}$'),
 ('FUJ','Fujairah','AE','Code','{A,B,C,D,E,F,G,K,M,P,R,S,T}','^[0-9]{1,5}$'),
 ('KSA','Saudi Arabia','SA','Letters',NULL,'^[0-9]{1,4}$'),
 ('OMN','Oman','OM','Letters',NULL,'^[0-9]{1,6}$'),
 ('QAT','Qatar','QA',NULL,NULL,'^[0-9]{1,6}$'),
 ('BHR','Bahrain','BH',NULL,NULL,'^[0-9]{1,6}$'),
 ('KWT','Kuwait','KW','Code',NULL,'^[0-9]{1,6}$');

INSERT INTO customer_title (code, name_en, name_ar) VALUES
 ('Mr','Mr.','السيد'),('Mrs','Mrs.','السيدة'),('Ms','Ms.','الآنسة'),('Dr','Dr.','الدكتور'),('Eng','Eng.','المهندس'),('Sheikh','Sheikh','الشيخ'),('Sheikha','Sheikha','الشيخة');

INSERT INTO lookup_value (list, code, name_en, sort) VALUES
 ('enquiry_source','walk_in','Walk-in',1),('enquiry_source','phone','Phone',2),('enquiry_source','whatsapp','WhatsApp',3),('enquiry_source','website','Website',4),('enquiry_source','other','Other',5),
 ('lost_reason','price','Price too high',1),('lost_reason','time','Could not wait',2),('lost_reason','elsewhere','Went elsewhere',3),('lost_reason','no_reply','No reply',4),
 ('delay_reason','parts','Waiting for parts',1),('delay_reason','approval','Waiting for customer approval',2),('delay_reason','extra_work','Extra work found',3),('delay_reason','technician','Technician not available',4),('delay_reason','qc_fail','QC failed',5);

INSERT INTO tax_code (code, name, rate, vat201_box) VALUES
 ('SR','Standard rated 5%',0.05,'1'),('ZR','Zero rated',0,'4'),('EX','Exempt',0,'5'),('OS','Out of scope',0,NULL),('RC','Reverse charge 5%',0.05,'3');

INSERT INTO service (code, name_en, name_ar, category, standard_hours, labour_rate, is_quick) VALUES
 ('SVC-10K','10,000 km service','صيانة 10,000 كم','service',1.5,180,false),
 ('SVC-60K','60,000 km service','صيانة 60,000 كم','service',2.5,180,false),
 ('BRK-FR','Front brake pads replace','تغيير فحمات الفرامل الأمامية','repair',1.0,180,false),
 ('AC-REGAS','AC gas recharge','تعبئة غاز المكيف','repair',1.0,160,false),
 ('ALIGN','Wheel alignment','ضبط الزوايا','tyre',0.75,160,false),
 ('OIL-QK','Oil change (quick)','تغيير زيت سريع','quick',0.5,120,true),
 ('TYRE-FIT','Tyre fitting and balancing (quick)','تركيب وترصيص إطار','quick',0.25,40,true),
 ('BATT-FIT','Battery replace (quick)','تغيير بطارية','quick',0.25,40,true),
 ('DIAG','Computer diagnosis','فحص كمبيوتر','service',0.5,180,false);

INSERT INTO item (part_no, description, brand, category, uom, list_price, item_type, preferred_supplier) VALUES
 ('OIL-5W30-L','Engine oil 5W-30 (litre)','Mobil','oils','L',32.00,'stock','Al Futtaim Lubricants'),
 ('FLT-OIL-90915','Oil filter Toyota 90915-YZZE1','Toyota','filters','EA',45.00,'stock','AGMC Parts'),
 ('BRK-PAD-FR-LC','Front brake pads Land Cruiser','Akebono','brakes','EA',380.00,'stock','AGMC Parts'),
 ('FLT-AIR-17801','Air filter Toyota 17801','Toyota','filters','EA',85.00,'stock','AGMC Parts'),
 ('TYR-2656517','Tyre 265/65R17 Bridgestone Dueler','Bridgestone','tyres','EA',400.00,'stock','Bridgestone Middle East'),
 ('BAT-70AH','Battery 70Ah AC Delco','AC Delco','batteries','EA',450.00,'stock','Exide Gulf'),
 ('WPR-24','Wiper blade 24 in','Bosch','accessories','EA',60.00,'stock','Bosch'),
 ('CLT-L','Coolant (litre)','Prestone','oils','L',25.00,'stock','Prestone');

-- Chart of accounts (Tally-style groups) and the posting mapping (AC-01, AC-02)
INSERT INTO account (code, name, account_group, account_type, sub_type) VALUES
 ('1100','Cash in drawer','Cash-in-hand','asset','cash'),
 ('1110','Card clearing','Bank accounts','asset','bank'),
 ('1120','Bank current account','Bank accounts','asset','bank'),
 ('1130','Post-dated cheques received','Current assets','asset','normal'),
 ('1200','Trade receivables','Sundry debtors','asset','receivable'),
 ('1300','Inventory','Stock-in-hand','asset','stock'),
 ('1310','Work in progress','Stock-in-hand','asset','stock'),
 ('2100','Goods received not invoiced','Current liabilities','liability','payable'),
 ('2200','VAT output','Duties and taxes','liability','vat_output'),
 ('2210','VAT input','Duties and taxes','asset','vat_input'),
 ('2300','Customer advances','Current liabilities','liability','normal'),
 ('3900','Opening balance equity','Capital account','equity','normal'),
 ('4100','Sales - labour','Sales accounts','income','normal'),
 ('4200','Sales - parts','Sales accounts','income','normal'),
 ('5100','Cost of sales - parts','Direct expenses','expense','normal');

INSERT INTO account_mapping (event_key, account_id, description)
SELECT k, (SELECT id FROM account WHERE code = a), d FROM (VALUES
 ('cash_drawer','1100','Cash receipts'),('card_clearing','1110','Card receipts'),('bank','1120','Bank transfers'),('pdc_received','1130','Cheques received'),
 ('trade_receivable','1200','Customer invoices'),('inventory','1300','Stock'),('work_in_progress','1310','Parts issued to open jobs'),
 ('goods_received_clearing','2100','Stock received before the supplier bill'),('vat_output','2200','Output VAT'),('customer_advances','2300','Receipts on account'),
 ('opening_balance','3900','Opening stock and balances'),('sales_labour','4100','Labour sales'),('sales_parts','4200','Parts and other sales'),('cost_of_sales','5100','Cost of parts sold')
) v(k, a, d);

-- Message templates (WA-03)
INSERT INTO message_template (event, language, body) VALUES
 ('enquiry_reply','en','Dear {title} {name}, thank you for contacting Superfix {branch} about {plate}. Your enquiry number is {job_no}. We will send your quotation shortly.'),
 ('quotation_for_approval','en','Dear {title} {name}, your quotation {doc_no} for {plate} at Superfix {branch} is ready. Total AED {amount} incl. VAT. Please review and approve here: {link}'),
 ('quotation_for_approval','ar','عزيزي {title} {name}، عرض السعر {doc_no} لسيارتك {plate} جاهز. الإجمالي {amount} درهم شامل الضريبة. للموافقة: {link}'),
 ('approved','en','Dear {title} {name}, thank you. Work on {plate} (job {job_no}) is approved and has started at Superfix {branch}.'),
 ('car_ready','en','Dear {title} {name}, your vehicle {plate} (job {job_no}) is ready for collection at Superfix {branch}.'),
 ('invoice','en','Dear {title} {name}, invoice {doc_no} for job {job_no}: AED {amount} incl. VAT. Thank you for choosing Superfix {branch}.');

-- Approval workflows (M10). Values from BRD 7.10 examples; all editable as settings.
INSERT INTO workflow (doc_type, name, enabled) VALUES
 ('discount','Discount and below-margin price', true),
 ('purchase_order','Purchase order', true),
 ('stock_transfer','Stock transfer', true),
 ('stock_adjustment','Stock adjustment', true),
 ('credit_note','Credit note', true);
INSERT INTO workflow_step (workflow_id, seq, name, approver_role_id, cond_min_amount, cond_max_amount, approver_role_scope)
SELECT w.id, s.seq, s.name, (SELECT id FROM role WHERE code = s.role), s.mn, s.mx, s.scope
FROM (VALUES
 ('discount',1,'Branch manager','branch_manager',NULL::numeric,NULL::numeric,'doc_branch'),
 ('purchase_order',1,'Branch manager (AED 5,001 and above)','branch_manager',5001,NULL,'doc_branch'),
 ('purchase_order',2,'Head-office finance (above AED 25,000)','accountant',25000.01,NULL,'any_branch'),
 ('stock_transfer',1,'Supplying branch manager','branch_manager',NULL,NULL,'supplying_branch'),
 ('stock_adjustment',1,'Branch manager','branch_manager',NULL,NULL,'doc_branch'),
 ('credit_note',1,'Branch manager','branch_manager',NULL,NULL,'doc_branch')
) s(doc, seq, name, role, mn, mx, scope) JOIN workflow w ON w.doc_type = s.doc;

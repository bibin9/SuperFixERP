# Superfix ERP (local build)

A garage ERP for Superfix built from the Softtech Superfix FSD v0.9. It runs on your own machine only: Next.js 16 with PostgreSQL 16, with no hosting and no external services.

## What you need

- Node.js 22 or newer
- PostgreSQL 16 running locally, with a superuser you can sign in as (the default is `postgres` / `postgres` on `localhost:5432`)

## Database

Everything runs against a local PostgreSQL. `npm run db:reset` creates two local databases: `superfix` for the app and `superfix_test` for the automated tests (rebuilt on every test run). Nothing is hosted.

## First run

```bash
cp .env.example .env        # edit PG_ADMIN_URL if your postgres password differs
# The sign-in cookie is marked secure only when the request came over https (x-forwarded-proto), so http://localhost works in Safari too.
# COOKIE_SECURE=true forces it, for an https set-up without that header.
npm install
npm run db:reset            # creates the database, the app role, the tables and the demo data
npm run dev                 # or: npm run build && npm start
```

Open http://localhost:3000 and sign in. Every demo user has the password **Superfix@2026**.

| User | Role | Branch |
|---|---|---|
| admin | Administrator | all |
| saeed | Owner | all |
| yousef | Branch manager | Yas (YAS) |
| priya | Service advisor | Yas, also Yas Service Station |
| khalid | Foreman | Yas |
| ramesh, arjun | Technicians | Yas |
| anil | Stock keeper | Yas |
| maryam | Accountant | all |
| fatima.hr | HR | all |
| omar | Branch manager | Qusais (QUS) |
| sara | Service advisor | Qusais |

`npm run db:reset` wipes and reloads everything, so you can always get back to the demo state.

## How work flows (FSD v0.10)

Every job follows one order: **enquiry, then quotation, then the customer's approval, then the job card.**

1. **Enquiry** (Enquiries, New enquiry): customer, vehicle, what they asked for, and the check-in details (odometer, fuel, complaints).
2. **Quotation** on the enquiry: add labour, parts and outside work, then save. A discount above your limit, or a price below the minimum margin, goes to the branch manager first.
3. **Customer approval**: "Prepare approval message" builds the WhatsApp text with the approval link. You send it yourself and press "Mark as sent". The customer approves line by line on the link, or you record an answer given in person or by phone.
4. **Job card**: once approved, "Create job card" makes it from the approved quotation. Parts for approved lines are committed at this point. Declined lines are saved as deferred work.

Extra work found later is added on the job card and goes to the customer as a revised quotation. The database itself refuses a job card that has no approved quotation.

**Messaging is manual only.** The app prepares the text and a WhatsApp link (or you copy the text), and logs who marked it as sent. Nothing is sent automatically. Payments are recorded by staff, and no payment gateway is called.

**Everything is configurable.** Admin, Master forms covers services and labour rates, parts, tax codes, payment methods, pick lists, titles, countries, plate set-up, message templates, bays, the chart of accounts and posting rules. Settings covers discount limits, margin, validity, sign-in, payroll and WPS values. Each change is audited.

## Phase 2: parts, purchasing and the workshop floor

- **Parts** (menu: Parts): stock on hand with reserved and committed quantities, a stock ledger per item, planning and back orders (with other branches' free stock), the store queue (technicians' part requests and parts to issue), transfers between branches (request, approve at the supplying branch, dispatch, receive with short-receipt reasons), stock adjustments with approval, and blind stock counts.
- **Purchasing** (menu: Purchasing): purchase orders with approval by amount, goods received (good and damaged quantities), supplier bills matched to receipts (a mismatch goes to the accountant; a duplicate supplier invoice is refused), and petty cash with a required receipt photo. Suppliers are a master form.
- **Workshop** (menu: Workshop): the workshop board (refreshes itself, colour by time to promise), a wall-screen link that works on a TV without signing in and shows no prices or customer names, and "My jobs" for technicians on a phone: clock in, pause with a reason, resume, clock out, one job at a time with a confirmed switch, and "Need part".
- **On the job card**: assign several technicians and a bay per labour line, clocked time against standard time, clock corrections by a supervisor (never your own), part requests, the quality check (a pass makes the car Ready, a fail sends it back with the reason), and the delivery form with walkthrough checklist, old parts, odometer and the customer's signature. Ready and Delivered can no longer be set by hand.

## Phase 3: billing

- **Invoicing** (job card, Prepare invoice): tick the lines to bill now and choose who pays: the customer, a fleet or company account (needs the LPO on the job if that company asks for one), or a warranty claim (no tax invoice; the parts cost goes to warranty). A buyer without a TRN, or an invoice of AED 10,000 or less, gets a simplified tax invoice (FSD 5.1). The print has the QR code, the amount in words and an Arabic title. "Print or save as PDF" uses the browser's print.
- **Payments** (invoice page): cash, card, bank transfer and cheque (cheque number, bank and date are required). Paying more keeps the rest on the customer's account. Money held for the customer (deposits, overpayments, credits) can be applied to any of their invoices at the same branch.
- **Deposits** (job card, Take deposit, or Billing, Advances): VAT is accounted when the deposit is taken and reversed when it is applied, so the VAT in total equals the invoice VAT. A deposit taken on a job is applied automatically when the job is invoiced.
- **Release gate**: the delivery form appears only when nothing is owed, the customer is on credit terms within the limit, or a branch manager has released the car on credit with a reason. The job closes once it is invoiced, handed over and fully paid.
- **Credit notes** (invoice page, Credit note): by quantity or a lower amount, with a reason; parts can go back into stock at the cost they went out at. The branch manager approves, then it gets its number. If the invoice was paid, the credit is held for the customer.
- **Cheques** (Billing, Cheques): post-dated cheques stay on hand until their date; Cleared moves them to the bank; Returned opens the invoice again (and a closed job goes back to Invoiced).
- **Counter sale** (Billing, Counter sale): VAT-inclusive prices from the customer's price level (retail, trade, fleet), free stock only, the role discount limit, minimum price and below-cost checks (the branch manager can override), and payment in the same step. A walk-in pays in full.
- **Cash closing** (Billing, Cash closing): each cashier counts the drawer by note and coin; a difference over the tolerance needs a note; the branch manager signs it off (never their own) and the difference is booked to cash over and short. No more cash can be taken by that cashier that day.
- **VAT return** (Accounting, VAT return): VAT 201 boxes with supplies by emirate, credit notes and deposits netted off, purchases and petty cash in box 9, a check against the VAT accounts in the ledger, and a list of the documents behind each box. The FTA audit file downloads as CSV, and each invoice has its e-invoice data as JSON (PINT AE fields) for an accredited provider later.
- **WhatsApp for invoices**: "Prepare WhatsApp" on the invoice builds the message with a link the customer can open without signing in. You send it yourself.

## Phase 4: accounting and the move from Tally

- **Financial statements** (Accounting, Financial statements): trial balance (with group totals), P&L, balance sheet and cash flow, for one branch, several, or the company, with branches side by side. Every amount drills down to the ledger, the journal and the source document. Branch managers see their own branches only; anyone who cannot see bank balances is refused the balance sheet, cash flow and bank ledgers with a plain message.
- **Ledgers and vouchers**: day book, ledger with running balance on any date, and vouchers (journal, payment, receipt, contra, debit and credit notes). A voucher must balance, a receivable or payable line must name the party, and the voucher goes to approval and gets its number only when posted.
- **Receivables and payables**: ageing by branch with credit limit and overdue, customer and supplier statements, supplier payments allocated bill by bill (cash, transfer or cheque), money paid on account used later against a bill, and issued cheques marked paid by the bank or cancelled (the payment is reversed and the bills open again).
- **Bank and reconciliation**: cheques falling due are flagged; card settlements post the bank's commission; bank statements import from CSV, match automatically by amount, date and reference, let you post a bank charge from a line, and lock when finished, with a reconciliation statement.
- **VAT**: reverse charge on imported services shows in boxes 3 and 10 of the VAT return.
- **Month end**: a checklist per month (cash sessions signed off, statements finished, stock counts closed, vouchers and bills posted, VAT tick); a month closes only in order and only when the checklist passes, and a closed month refuses postings. Only the owner reopens a month, with a reason that is logged. Year end moves the profit to retained earnings. Head-office costs are charged to branches by revenue or fixed shares. Fixed assets with straight-line depreciation and disposal. Budgets by branch and month against actual.
- **Opening from Tally** (Month end, Opening): step 1 imports masters (ledgers, suppliers, stock items, customers) from CSV; step 2 checks the opening ledger balances and open bills and reports every problem without writing anything; step 3 loads them by branch and party; step 4 compares with the Tally trial balance and the accountant signs off.

## Phase 5: HR and payroll

- **Employee file** (HR, Employees): personal details, branch, department, line manager, contract, probation, bank IBAN or WPS card, custom fields added by the admin (Master forms, Employee custom fields), joining and leaving checklists. Tabs hold documents with expiry (passport, visa, Emirates ID, labour card and so on), insurance, air ticket entitlement, the visa and labour process, company assets issued, warnings, performance reviews and training.
- **HR dashboard**: headcount by branch and nationality, joiners and leavers, overtime and leave waiting, and documents or contracts expiring.
- **Attendance**: punches from devices (CSV import), mobile check-in by GPS within the branch radius or the branch QR code, and punches added by hand with a reason. Late minutes are counted against the shift. **Roster**: weekly plan per branch with days off and public holiday cover.
- **Leave and overtime**: leave types and balances under UAE Labour Law; requests go to the line manager, then HR. Overtime is approved before payroll at the normal, night, rest day and holiday rates (Settings, Payroll).
- **Letters**: salary certificate, salary transfer letter, experience certificate and employment letter from templates (add more under Master forms), each with a reference.
- **Transfers** between branches with an effective date; the organisation chart follows them. **Recruitment**: openings, applicants, interviews, offer and hire into a new employee file.
- **Self-service** (My HR): profile, attendance, leave balance and requests, payslips, letters and advances, on a phone.
- **Payroll** (Payroll): HR calculates the month, the payroll check flags changes from last month, the owner approves (the month is locked), it posts the salary cost to each branch, the WPS salary file (SIF) is made per agent, and the run is marked paid. The owner can reopen an approved run with a reason. Salary updates, advances and loans go through approval; loan instalments are taken each month within the deduction cap. The branch register has one column per salary component with branch totals. Final settlement works out gratuity, unused leave and open loans. Each month the run accrues gratuity, leave salary and air tickets and posts them with the salary cost by branch; Payroll, Liabilities shows the gratuity owed and the loans to recover by branch.

## Phase 6: reports, report builder and archive

- **Reports dashboard**: today and the chosen period by branch (sales, cars in and out, cash) and the enquiry-to-invoice funnel. Each figure opens the list behind it.
- **All reports**: 35 standard reports in nine areas (workshop, technicians, sales, customers, parts, purchasing, finance, HR and payroll, approvals), including TR-01 next service (with "Prepare WhatsApp" for you to send yourself), TR-02 sales, TR-03 purchases, TR-04 pending LPOs, TR-05 pending transfer notes and TR-06 the insurance register. Every report has branch, date and people filters, Excel and CSV export, and Print or PDF on the letterhead.
- **Copy a report**: choose, rename and reorder its columns and keep its filters. The standard report stays as it is.
- **Report builder**: pick a data source, columns with totals, counts and averages, filters (or questions asked when it runs), sort, subtotals, a pivot, calculated columns and a bar, line or pie chart. There is no free SQL.
- **Sharing**: keep a report private or share it with roles or users, and add it to the menu. Pin any report to your reports dashboard as a table or chart.
- **Schedules**: a report can be prepared daily, weekly or monthly as an Excel file in your Report inbox. Nothing is emailed; download it and send it yourself.
- **Archive** (Reports, Archive): the owner runs it every 6 months (Settings). Closed, paid and posted records older than the live window (12 months) become archived and read only. Customers, vehicles, items, suppliers, staff and settings are never archived. Every report has a Data selector: Live, Archived, or one archive run. Each run is logged with its counts and a ledger check.
- **Who sees what**: you see a report if you have Reports view and can view its module at the branch. Salary reports also need the salary field. Hidden fields (cost, margin, salary and so on) are removed from report columns, the builder, exports and shared reports.

## Added after Superfix's review on 17 November 2026

- **Voucher numbering**: each voucher type has its own series per branch (YAS-JRN-, YAS-PMT-, YAS-RCV-, YAS-CON-, YAS-DBN-, YAS-CRN-), editable under Document numbering.
- **Audit log** is its own permission (view, export). Every entry keeps the user and the role they acted in; documents have a "History: who did what" panel; the log filters by user and exports to CSV.
- **Customers**: price level is a pick list (Retail, Trade, Fleet; add more under Master forms). Companies have e-invoicing details: Peppol ID, trade licence, structured address and contact phone. A tax invoice to a VAT-registered company needs them (setting einvoice.require_buyer_details).
- **Transfer orders**: a stock transfer between branches is called a transfer order, not a purchase order.
- **Booking calendar** (Front office): book the visit on the enquiry (day and time, bay, technician, hours). As you pick the day, each bay's and technician's hours for that day are shown, with this booking added, and you are warned before going over. Over capacity needs a reason (or is refused, setting workshop.overbook_policy). The calendar shows the day's load, the bookings, a seven-day strip and the day's runs. Capacity: Bays master (hours a day) and Technician capacity master.
- **Pickup, drop-off, recovery and towing runs** (Workshop): each run has a driver (staff or an outside driver), from, to, when, the truck, distance and status. Schedule it from the enquiry or the job card; its charge can go on the quotation or the job card as extra work, for the customer to approve. The runs page filters by driver, type, status and dates.
- **Vehicle page**: one page with the owner and quick actions (call, WhatsApp chat, book a visit, customer file, unpaid invoices), the open job lines with technician, estimated hours and status, the next service due (by date or km, interval per vehicle or from Settings), runs and past services from every branch.
- **Errors under the field**: when the server refuses a form, the message is shown in red under the field it is about, the field is outlined and focused, and what you typed is put back.

## Fixed after the Codex QA report (18 November 2026)

- **Phone lists** no longer jump after loading: the one-card-per-row layout is chosen by CSS in the page the server sends, and each value's column name is filled in before the page is first painted.
- **Contrast**: grey sub-titles and the green, amber and red status badges now meet 4.5:1.
- **Table headings**: the enquiries list's last column is "Job card"; other button columns have a heading that screen readers read ("Actions").
- **Sign-in page** and the public quotation page have a main landmark; the logo has a fixed width and height everywhere.
- **Customer list** counts vehicles in one pass for the page shown, and migration 016 adds the vehicle-owner index and other lookup indexes.

- **Posting twice is prevented**: every posting form (invoice, payment, advance, counter sale, stock issue) carries a request key. A repeat of the same submission, even many at once, gets the first result back; the same key used for something different is refused. Invoices, payments, advances and credit notes lock the job card first, and a database deadlock is retried automatically, so busy counters do not see server errors (migration 017).

## Demo data you will see

- **YAS-ENQ-26-00001**: Faisal's 60K service, 103.50 discount, quotation YAS-Q-26-00001-1 sent. The total is 978.08, which matches the FSD 5.1 worked example. Open the customer link to approve, then create the job card.
- **YAS-ENQ-26-00002 / job YAS-1483**: approved in person (wiper declined), job card created from the approved quote, oil issued, at Ready. Use "Prepare invoice", take a payment, then deliver the car: the job closes.
- **YAS-ENQ-26-00003 / job YAS-1484**: Noura's Prado (AC and battery), in progress. Ramesh and Arjun share the AC work and Arjun is clocked in on the battery. Sign in as **arjun** or **ramesh** on a phone and open My jobs; sign in as **khalid** (foreman) for the board and the quality check.
- **QUS-ENQ-26-00001**: a fleet quotation saved but not sent, at another branch. Sign in as priya and you cannot open it; sign in as omar and you can.
- **HR**: twelve employees across the branches with salaries, documents (Ramesh's passport expires within 30 days, his insurance within 60), shifts, holidays and a leave request. Sign in as **fatima.hr** for HR and payroll.
- **Service history**: eight imported older customers and vehicles with closed job cards from 6 to 26 months ago, so the next service report and the archive have data. Four of them are old enough to archive.
- **Purchases**: one posted supplier bill (Al Futtaim Lubricants, workshop cleaning supplies) so the purchase report has a row.

## Tests

```bash
npm test                    # 94 tests against a separate superfix_test database (wiped on each run)
npm run typecheck
# Browser smoke test (needs the app running on :3000 and Playwright installed):
node tests/e2e-smoke.mjs ./shots
# Browser test passes (each needs a fresh demo database: npm run db:reset, then the app on :3000):
node tests/uat/ui-test-pass.mjs          # 66 test cases from the QA workbook
node tests/uat/phase2-workshop.mjs       # clocking, quality check, delivery with signature
node tests/uat/phase2-purchasing.mjs     # PO approval, goods received, matched bill, duplicate refused
node tests/uat/phase3-billing.mjs        # release gate, invoice, payments, invoice link, credit note, counter sale, deposit, cash closing, VAT return
node tests/uat/phase4-accounting.mjs     # vouchers, supplier payments and cheques, bank reconciliation, statements, month end, opening balances
node tests/uat/review-fixes.mjs          # voucher series, audit log users and roles, e-invoicing fields, price level, transfer orders
node tests/uat/bookings-runs.mjs         # booking load and overbooking, runs, vehicle page, errors under the field
node tests/uat/phase5-hr-payroll.mjs     # 27 cases: employee file, attendance, leave, overtime, letters, transfers, recruitment, payroll run, WPS, loans, settlement
node tests/uat/phase6-reports.mjs        # 29 cases: dashboard, standard reports, hidden fields and branch scope, export, print, copy, builder, sharing, schedules, archive
```

The tests cover the quote-before-job rule (service and database), manual-only messaging, master forms and their audit, branch isolation at the service and database level, hidden prices for technicians, the discount approval workflow (including no self-approval), gap-free numbering under concurrency, the VAT worked example, stock commitments and back orders, the customer approval link, and the invoice and receipt flow including idempotency. Phase 3 adds split, fleet and warranty billing, deposits with VAT, cheques (post-dated and returned), credit notes with approval and restock, counter sales, the release gate, cash closing, the customer invoice link and the VAT return checked against the ledger. Phase 4 adds vouchers with approval, supplier payments and cheques, statements that agree with each other, bank reconciliation, period close and reopen, HO allocation, assets, budgets and the opening balances from Tally. Phase 5 adds gratuity, overtime, leave accrual, pro-rating, the deduction cap, the branch split, the WPS file and the payroll run. Phase 6 adds report branch scope, hidden columns by role, builder refusals, export permission, schedule periods and the archive (only closed records, balanced, read only).

## How it is put together

- `db/migrations/` holds the schema. Branch isolation uses PostgreSQL row-level security. The app connects as `superfix_app`, which cannot bypass it. Ledgers (journals, stock moves, audit log, approval actions, consent log) are append-only at the grant level.
- `lib/access.ts` loads the user's roles, the permission matrix and the field permissions. Hidden fields (cost, margin, selling price, discount, salary, bank balance) are removed on the server, not only in the page.
- `lib/services/` holds the business logic: customers, enquiries, jobs, quotations, workflow, stock, billing, ledger, messaging, HR and payroll, reports and master forms (`master-forms.ts` is the one registry of master screens; `reports.ts` is the registry of standard reports; `report-builder.ts` holds the builder's fixed data sources).
- `app/` holds the pages and server actions. `app/q/[token]` is the public customer approval page.
- Settings that change behaviour live in Admin > Settings and Admin > Master forms, not in code.

See `ASSUMPTIONS.md` for the decisions made where the FSD's open questions are still unanswered.

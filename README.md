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

## Demo data you will see

- **YAS-ENQ-26-00001**: Faisal's 60K service, 103.50 discount, quotation YAS-Q-26-00001-1 sent. The total is 978.08, which matches the FSD 5.1 worked example. Open the customer link to approve, then create the job card.
- **YAS-ENQ-26-00002 / job YAS-1483**: approved in person (wiper declined), job card created from the approved quote, oil issued, at Ready. Use "Prepare invoice", take a payment, then deliver the car: the job closes.
- **YAS-ENQ-26-00003 / job YAS-1484**: Noura's Prado (AC and battery), in progress. Ramesh and Arjun share the AC work and Arjun is clocked in on the battery. Sign in as **arjun** or **ramesh** on a phone and open My jobs; sign in as **khalid** (foreman) for the board and the quality check.
- **QUS-ENQ-26-00001**: a fleet quotation saved but not sent, at another branch. Sign in as priya and you cannot open it; sign in as omar and you can.

## Tests

```bash
npm test                    # 55 tests against a separate superfix_test database (wiped on each run)
npm run typecheck
# Browser smoke test (needs the app running on :3000 and Playwright installed):
node tests/e2e-smoke.mjs ./shots
# Browser test passes (each needs a fresh demo database: npm run db:reset, then the app on :3000):
node tests/uat/ui-test-pass.mjs          # 66 test cases from the QA workbook
node tests/uat/phase2-workshop.mjs       # clocking, quality check, delivery with signature
node tests/uat/phase2-purchasing.mjs     # PO approval, goods received, matched bill, duplicate refused
node tests/uat/phase3-billing.mjs        # release gate, invoice, payments, invoice link, credit note, counter sale, deposit, cash closing, VAT return
```

The tests cover the quote-before-job rule (service and database), manual-only messaging, master forms and their audit, branch isolation at the service and database level, hidden prices for technicians, the discount approval workflow (including no self-approval), gap-free numbering under concurrency, the VAT worked example, stock commitments and back orders, the customer approval link, and the invoice and receipt flow including idempotency. Phase 3 adds split, fleet and warranty billing, deposits with VAT, cheques (post-dated and returned), credit notes with approval and restock, counter sales, the release gate, cash closing, the customer invoice link and the VAT return checked against the ledger.

## How it is put together

- `db/migrations/` holds the schema. Branch isolation uses PostgreSQL row-level security. The app connects as `superfix_app`, which cannot bypass it. Ledgers (journals, stock moves, audit log, approval actions, consent log) are append-only at the grant level.
- `lib/access.ts` loads the user's roles, the permission matrix and the field permissions. Hidden fields (cost, margin, selling price, discount, salary, bank balance) are removed on the server, not only in the page.
- `lib/services/` holds the business logic: customers, enquiries, jobs, quotations, workflow, stock, billing, ledger, messaging and master forms (`master-forms.ts` is the one registry of master screens).
- `app/` holds the pages and server actions. `app/q/[token]` is the public customer approval page.
- Settings that change behaviour live in Admin > Settings and Admin > Master forms, not in code.

See `ASSUMPTIONS.md` for the decisions made where the FSD's open questions are still unanswered.

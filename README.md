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

## Demo data you will see

- **YAS-ENQ-26-00001**: Faisal's 60K service, 103.50 discount, quotation YAS-Q-26-00001-1 sent. The total is 978.08, which matches the FSD 5.1 worked example. Open the customer link to approve, then create the job card.
- **YAS-ENQ-26-00002 / job YAS-1483**: approved in person (wiper declined), job card created from the approved quote, oil issued, at Ready. Use "Prepare tax invoice", then take a payment.
- **QUS-ENQ-26-00001**: a fleet quotation saved but not sent, at another branch. Sign in as priya and you cannot open it; sign in as omar and you can.

## Tests

```bash
npm test                    # 29 tests against a separate superfix_test database (wiped on each run)
npm run typecheck
# Browser smoke test (needs the app running on :3000 and Playwright installed):
node tests/e2e-smoke.mjs ./shots
```

The tests cover the quote-before-job rule (service and database), manual-only messaging, master forms and their audit, branch isolation at the service and database level, hidden prices for technicians, the discount approval workflow (including no self-approval), gap-free numbering under concurrency, the VAT worked example, stock commitments and back orders, the customer approval link, and the invoice and receipt flow including idempotency.

## How it is put together

- `db/migrations/` holds the schema. Branch isolation uses PostgreSQL row-level security. The app connects as `superfix_app`, which cannot bypass it. Ledgers (journals, stock moves, audit log, approval actions, consent log) are append-only at the grant level.
- `lib/access.ts` loads the user's roles, the permission matrix and the field permissions. Hidden fields (cost, margin, selling price, discount, salary, bank balance) are removed on the server, not only in the page.
- `lib/services/` holds the business logic: customers, enquiries, jobs, quotations, workflow, stock, billing, ledger, messaging and master forms (`master-forms.ts` is the one registry of master screens).
- `app/` holds the pages and server actions. `app/q/[token]` is the public customer approval page.
- Settings that change behaviour live in Admin > Settings and Admin > Master forms, not in code.

See `ASSUMPTIONS.md` for the decisions made where the FSD's open questions are still unanswered.

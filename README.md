# Superfix ERP (local build)

A garage ERP for Superfix built from the Softtech Superfix FSD v0.9. It runs on your own machine only: Next.js 16 with PostgreSQL 16, with no hosting and no external services.

## What you need

- Node.js 22 or newer
- PostgreSQL 16 running locally, with a superuser you can sign in as (the default is `postgres` / `postgres` on `localhost:5432`)

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

## Demo data you will see

- **YAS-1483**: a 60K service for Faisal, 103.50 discount, quotation sent. The total is 978.08, which matches the FSD 5.1 worked example. Open the quotation's customer link to approve or decline lines as the customer.
- **YAS-1484**: approved in person (wiper declined), oil issued, at Ready. Use "Create invoice" to post a tax invoice and then take a receipt.
- **QUS-0731**: a quotation saved but not yet sent, at another branch. Sign in as priya and you cannot open it; sign in as omar and you can.

## Tests

```bash
npm test                    # 26 tests against a separate superfix_test database
npm run typecheck
# Browser smoke test (needs the app running on :3000 and Playwright installed):
node tests/e2e-smoke.mjs ./shots
```

The tests cover branch isolation at the service and database level, hidden prices for technicians, the discount approval workflow (including no self-approval), gap-free numbering under concurrency, the VAT worked example, stock commitments and back orders, the customer approval link, and the invoice and receipt flow including idempotency.

## How it is put together

- `db/migrations/` holds the schema. Branch isolation uses PostgreSQL row-level security. The app connects as `superfix_app`, which cannot bypass it. Ledgers (journals, stock moves, audit log, approval actions, consent log) are append-only at the grant level.
- `lib/access.ts` loads the user's roles, the permission matrix and the field permissions. Hidden fields (cost, margin, selling price, discount, salary, bank balance) are removed on the server, not only in the page.
- `lib/services/` holds the business logic: customers, jobs, quotations, workflow, stock, billing, ledger.
- `app/` holds the pages and server actions. `app/q/[token]` is the public customer approval page.
- Settings that change behaviour (discount limits, minimum margin, lockout, payment gateway, WPS and payroll) live in Admin > Settings, not in code.

See `ASSUMPTIONS.md` for the decisions made where the FSD's open questions are still unanswered.

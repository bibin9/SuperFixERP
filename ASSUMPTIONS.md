# Assumptions

The FSD v0.9 open questions are unanswered, so this build uses the FSD's own proposed defaults. Each one is a setting or a small code change, so it can be changed once Superfix answers.

## FSD open questions

| Q | Topic | What this build does |
|---|---|---|
| Q1 | Stack | Next.js and PostgreSQL, run locally. |
| Q2 | Payment gateway | Set to `none`. Card receipts are recorded manually. The setting is `payment.gateway`. |
| Q3 | Who assigns technicians | The service advisor (and foreman or manager). |
| Q4, Q5 | Payroll and WPS | Placeholder settings only (`payroll.*`, `wps.*`). HR and payroll are not built yet. |
| Q6 | Quick invoice limit | 500 AED, stored as a setting. The quick invoice screen itself is not built yet. |
| Q7 | On-time measure | A job is on time if it reaches Ready by its promised time. A late job needs a delay reason before it can move on or be invoiced. |
| Q11 | Simplified tax invoices | Not used. Every invoice is a full tax invoice. |
| Q12 | Warranty comeback window | 0 days and 12 months defaults, as settings. A new job on a vehicle with a recent job is flagged as a possible comeback. |

## Other decisions made during the build

- **Discount approval.** The discount workflow's single step (branch manager) has no condition of its own. It fires when a quotation's discount is above the advisor's role limit (advisor 10%, manager 25%, owner 100%, foreman 0%) or a price is below the minimum margin (10%).
- **Workflow conditions.** Amount bands include both ends. "Discount above x%" means strictly above.
- **No approver available.** If no user holds the approver role and there is no backup user, the task stays with the role, so whoever is given the role later sees it.
- **Self-approval** is never allowed, even for the owner.
- **Quotation revisions.** A new revision keeps the approved lines at the amounts the customer approved (including their share of the earlier discount). Only new lines are priced and need approval. A customer-approved revision stays "approved" as the record of what they signed, and it caps billing until the next revision is approved.
- **Invoicing** is allowed from Ready or Delivered, only for approved lines, only when parts are issued, and never above the approved total.
- **Overpayments** go to customer advances.
- **Sign-in.** Username and password only, with lockout after repeated failures and an idle timeout. PIN sign-in and device registration are not built.
- **Seed data is synthetic.** Branch names and job numbers come from the BayPilot prototype. Customers, the company TRN (100000000000003) and all amounts are made up.

## Not built yet (later FSD phases)

Purchasing (PO, GRN, supplier bills), stock transfers between branches, the workshop clocking board, QC checklists, credit notes, cash closing, the VAT 201 report, HR and payroll, reports and archive, the Arabic interface, photos and signatures, and the QR code on invoices. The workflows for purchase orders, transfers, adjustments and credit notes are already seeded, so those modules can plug into the approval engine.

# Assumptions

## Changes from Superfix on 16 November 2026 (FSD v0.10)

1. **Job card only after an approved quotation.** The flow is enquiry, quotation, customer approval, then job card. Booking and check-in details are kept on the enquiry. The job card starts at Approved, and the database refuses any job card without an approved quotation from the same enquiry.
2. **Messaging manual only.** WhatsApp messages are prepared by the app and sent by staff, who mark them as sent. The automatic WhatsApp Business API mode was removed. The payment-link gateway was also removed: payments are recorded by staff. Branch WhatsApp mode can only be Manual.
3. **Everything configurable.** All business values are settings or master records with add, edit and deactivate screens, audited.

Decisions made to apply these:

- Parts are committed when the job card is created, for approved lines only (not when the quotation is saved). The quotation shows whether each part is in stock at the branch.
- The advisor creates the job card from the approved enquiry; approval alone does not create it, so the advisor can set job type, promised time and odometer.
- If the customer declines every line, the enquiry closes as Lost with the reason "Customer declined the quotation".
- Extra work found during the job stays on the job card and is approved through a revised quotation, since the job card already exists.
- Quick invoice (OT-02), when built, will record the enquiry, a quotation approved in person and the job card in one screen, so it keeps the same order.
- Job types and job statuses stay system-defined, because the system's rules depend on them (for example a warranty comeback needs the original job). Their labels can be made editable later if wanted.

The FSD v0.9 open questions are unanswered, so this build uses the FSD's own proposed defaults. Each one is a setting or a small code change, so it can be changed once Superfix answers.

## FSD open questions

| Q | Topic | What this build does |
|---|---|---|
| Q1 | Stack | Next.js and PostgreSQL, run locally. |
| Q2 | Payment gateway | Not used (manual only, per Superfix). Payments are recorded by staff. |
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
- **Quotation revisions.** Quotation numbers follow the enquiry (YAS-Q-26-00001-1 is revision 1 of enquiry YAS-ENQ-26-00001). A new revision keeps the approved lines at the amounts the customer approved (including their share of the earlier discount). Only new lines are priced and need approval. A customer-approved revision stays "approved" as the record of what they signed, and it caps billing until the next revision is approved.
- **Invoicing** is allowed from Ready or Delivered, only for approved lines, only when parts are issued, and never above the approved total.
- **Overpayments** go to customer advances.
- **Sign-in.** Username and password only, with lockout after repeated failures and an idle timeout. PIN sign-in and device registration are not built.
- **Seed data is synthetic.** Branch names and job numbers come from the BayPilot prototype. Customers, the company TRN (100000000000003) and all amounts are made up.

## Not built yet (later FSD phases)

Purchasing (PO, GRN, supplier bills), stock transfers between branches, the workshop clocking board, QC checklists, credit notes, cash closing, the VAT 201 report, HR and payroll, reports and archive, the Arabic interface, photos and signatures, and the QR code on invoices. The workflows for purchase orders, transfers, adjustments and credit notes are already seeded, so those modules can plug into the approval engine.

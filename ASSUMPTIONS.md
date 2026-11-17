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

## Phase 2 decisions (parts, purchasing, workshop)

- **Transfers in transit.** Dispatch moves value to "Stock in transit" at the sending branch; receipt takes it out at the receiving branch. A short receipt needs a reason and its value stays in transit until accounting (phase 4) adds inter-branch accounts and a write-off step.
- **Damaged goods** on a receipt are recorded but not taken into stock or billed; the bill is matched to the good quantity.
- **Bill matching.** A bill line matches when the quantity equals the received, unbilled quantity and the price is within the larger of 1% or AED 5 (both settings). A mismatch waits for the accountant and posts nothing until approved. A bill against receipts belongs to the receiving branch.
- **Reverse charge** VAT on imported goods is not calculated yet; suppliers carry a reverse-charge flag for phase 4.
- **Clocking.** A technician works on one line at a time. Clocking into another pauses the first as "Switched job" after they confirm. Clocked time counts only working periods. Clock-in is not yet linked to attendance (phase 5).
- **Quality check.** Only a foreman or manager (workshop edit right) records it. A late job needs a delay reason before it can pass.
- **Delivery.** All walkthrough items must be ticked; odometer out cannot be lower than check-in. The signature is optional so a car can be released to someone who cannot sign, but "Received by" is required.
- **Wall screen.** The board link is a random code per branch, shows plates, make, model, bay and technicians only, and can be replaced at any time.

## Phase 3 decisions (billing)

- **Order of events.** Posting an invoice moves the job to Invoiced; it no longer marks the car as delivered. Delivery is a separate step on the job card, and the job closes when it is invoiced, handed over and fully paid.
- **Release gate.** "Owed" is approved work not yet invoiced plus open invoices on the job, less deposits held on it. Credit terms count only when the customer has payment terms and the new amount stays within the credit limit. A manager's release is recorded with the amount and reason and printed on the delivery record.
- **Simplified invoices** follow FSD 5.1: no TRN, or a registered buyer at AED 10,000 or less. Both the switch and the limit are settings. Superfix's open question Q11 ("full tax invoices only") can be answered by turning the setting off.
- **QR code.** The UAE does not prescribe a QR format, so the code holds the seller, TRN, invoice number, date, total, VAT and the invoice link.
- **PDF.** Invoices and credit notes are printed or saved as PDF through the browser's print dialog; no PDF library or service is used.
- **Arabic.** The invoice and credit note titles and the company name are bilingual; a fully Arabic layout is left for the print-template work in phase 6.
- **VAT on deposits** follows the FTA rule that VAT is due on a payment received before the supply (setting, default on). A returned deposit cheque reverses that VAT in the ledger; the VAT return lists the deposit and its reversal on application only.
- **Credit notes** use the original invoice line's VAT rate, take the remainder on the last credit so no fils are stranded, and are numbered only when posted. Restocked parts come back at the cost they were sold at.
- **Counter sales.** A sale with a discount above the advisor's limit, or a price below the minimum or below cost, has to be made by the branch manager (there is no separate approval queue for counter sales). Trade and fleet price levels are 90% and 93% of list in the demo data; the monthly fleet statement (OT-06) and trade account flows (SL-02) are left for the reports phase.
- **Cash closing** is one count per cashier per day; after closing, that cashier cannot take more cash that day.
- **E-invoicing.** The JSON follows the PINT AE field names so an accredited service provider can map it later; nothing is sent anywhere.

## Not built yet (later FSD phases)

Journals, bank reconciliation and period close (phase 4); HR and payroll (phase 5); reports, statements and archive (phase 6); the Arabic interface.

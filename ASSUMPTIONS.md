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
| Q4, Q5 | Payroll and WPS | Built with settings to confirm with the bank: MOHRE establishment ID 1000000123456 and employer reference SUPERFIX (demo values), pro-rating on a 30-day month (`payroll.proration_basis`, or calendar days). |
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

## Phase 4 decisions (accounting)

- **Voucher approval.** Every manual voucher goes to approval (owner by default; the accountant is the backup so the owner's own voucher can still be approved). It gets its number when posted.
- **Debit and credit notes to suppliers** are entered as vouchers against the supplier's account; they reduce the balance owed but are not allocated bill by bill.
- **Head-office allocation** is by revenue or by fixed shares (a setting). Headcount comes with HR in phase 5.
- **Dates.** Allocation and depreciation for the current month are dated today, not month end, so they never sit in the future.
- **Reverse charge.** The supplier is owed the net amount; output VAT and input VAT are both posted, and the return shows the VAT in boxes 3 and 10.
- **Year end** runs from the last day of December; the profit moves to retained earnings per branch.
- **Opening from Tally.** One opening batch only. Opening stock goes in through Stock opening receipts, so leave account 1300 out of the ledger CSV. The masters import needs the admin's settings permission. The one-month parallel run (TM-04) is a process step for Superfix at go-live, supported by the Tally comparison and ledger balances on any date.
- **Bank statement import** reads CSV (date, description, reference, amount or debit and credit). Lines already imported are skipped.

## Decisions from the 17 November 2026 review

- **Voucher series.** Vouchers posted before the change keep their VCH numbers. New ones use the series of their type.
- **Audit roles.** The role stored is the user's role at the entry's branch when they acted. Older entries show the user's current role.
- **Buyer e-invoicing details** are checked when a tax invoice is posted to a VAT-registered company or government customer (Peppol ID, trade licence, city, emirate). Individuals are not asked for them. The setting turns the check off.
- **Booking load.** A day's load of a bay or technician is the hours of its open bookings plus the labour hours of assigned job lines that are not finished, counted on their planned start day, or today when no start is planned. A booking that is checked in (its job card exists) stops counting as a booking; its lines count once assigned. Booking hours default to the enquiry's labour hours, else the setting workshop.default_booking_hours. Technicians without a Technician capacity row use workshop.technician_day_hours. Bookings are allowed up to workshop.booking_days_ahead days ahead and not in the past.
- **Overbooking** is allowed with a reason by default (warn). Set workshop.overbook_policy to block to refuse it. The reason is kept on the enquiry and in its history, and the calendar flags it.
- **Runs.** A driver is a user of the branch or an outside driver typed by name. A run's charge goes through the normal work lines (an outside line), so the customer approves it with the quotation, or as extra work on the job card. Runs not linked to an enquiry or job carry no charge.
- **Next service due** counts from the last finished service job (date and odometer at check-in), every N km or M months, whichever comes first. The interval is per vehicle, else the Settings defaults (10,000 km, 6 months). "Due soon" is within 30 days or 1,000 km.
- **Errors under the field.** The server names the field when it can; otherwise the message is matched to the field whose label it starts with. If no field matches, the message stays at the top of the page only. Typed values are kept for two minutes in the browser tab's session storage, never on the server; passwords and file fields are not kept.
- **Left for after go-live** (Superfix's choice): the advisor leaderboard and the bay timeline.

## Phase 5 decisions (HR and payroll)

- **Overtime rate** per hour is basic x 12 / 365 / 8, times the multiplier: 1.25 normal, 1.5 at night (22:00 to 04:00), on the rest day or a public holiday without a substitute day off. Overtime counts for payroll only once approved. Days with more than 2 hours are flagged on the payroll check.
- **Gratuity** is 21 days' basic a year for the first five years and 30 days after, nothing under one year, capped at 24 months' basic (settings). Unlimited contracts and resignation are treated the same under the current law.
- **Annual leave**: none in the first six months, 2 days a month up to one year, then 30 days a year (2.5 a month). Public holidays inside a leave are not counted.
- **Pro-rating** of joiners, leavers and unpaid leave uses monthly x days / 30.
- **Deductions** in a month are capped at 50% of the wage. A loan instalment that does not fit moves to the next month. An advance or loan cannot exceed 3 months' salary.
- **Branch split**: when an employee moves branch mid-month the cost is split by days in each branch; the last branch takes the rounding. The employee is paid once.
- **Approvals**: HR calculates; the owner (an approver at HQ, setting `payroll.approval_branch`) approves payroll, salary updates and final settlements. An approved month is locked; the owner can reopen it with a reason.
- **Period close**: once payroll has been run for any month, a month cannot be closed in accounts until its payroll is posted. Months before the first payroll run are not held back.
- **WPS**: one SIF file per agent (bank or exchange house), an EDR line per employee and the SCR control line. The file is downloaded and uploaded to the bank by HR; nothing is sent.
- **Accountant and HR** (Superfix's choice, 17 Nov): the accountant sees payroll only as postings in the accounts (journals, ledgers, the day book). HR screens and payroll runs are for HR, the owner and line managers.
- **Technician incentives (PR-06)** are not built, as the BRD says "if Superfix uses them". Clock data is kept, so they can be added.
- **Defect D-37** (found in QA): loan instalments were not deducted because the run did not read the loan's start month. Fixed and covered by a test.

## Phase 6 decisions (reports and archive)

- **Who sees a report**: Reports view at the branch and view of the report's module there (for example invoices for sales reports, HR for HR reports). Salary reports also need the salary field. The branch list offers only branches where both hold; asking for another branch in the address is refused. Export needs Reports export at every branch chosen.
- **Hidden fields** remove the column, not just the values. A shared or pinned report runs with the permissions of the person opening it, so a report with cost shared with advisors opens without the cost column and says so.
- **The builder** works on fixed data sources with named fields. There is no free SQL. Filters, calculated columns and pivots work only on those fields. A report returns at most 5,000 rows (setting `reports.max_rows`) and says when it stops.
- **Scheduled reports** are prepared into the user's Report inbox when it is opened (and with Prepare now), because there is no email service and no background job. The file uses the filters saved with the schedule and the period: daily is yesterday, weekly the last 7 days, monthly last month.
- **Service reminders (OT-01)**: the next service report prepares the WhatsApp text from the `service_due` template; staff send it themselves and mark it as sent.
- **Customer feedback after delivery (OT-04)** is not built yet.
- **Archive** is by marking records in the same database (an `archive_member` list), not by moving them to another schema. Archived documents cannot be changed (a database trigger refuses it). Ledgers, journals and stock moves are never moved, so financial statements and balances always read every journal and carry forward without a separate opening entry. The run checks that the archived journals balance before it saves. Records are kept 7 years (`archive.keep_years`); nothing is deleted.
- **Imported service history** in the demo data stands in for history migrated from the old system, so that the next service report and the archive have something to show.
- **Defects found in QA**: D-38 a copied report ignored a column moved to position 0; D-39 pivot headings showed internal codes (labour, part) instead of words. Both fixed.

## Not built yet

The Arabic interface, technician incentives (PR-06), customer feedback links (OT-04), the quick invoice screen, and PIN sign-in.

import type { HelpTopic } from "./types";

export const BACK: HelpTopic[] = [
  // ---------------- Purchasing ----------------
  {
    slug: "purchase-orders", group: "Purchasing", title: "Purchase orders and receiving goods",
    summary: "Order from a supplier, get approval, and receive the goods into stock.", who: "Purchasing officer, stock keeper",
    access: ["purchasing"], open: { label: "Open Purchase orders", href: "/purchasing" }, flows: ["purchase"],
    parts: [
      { h: "Create the order", steps: [
        "Open **Purchasing, Purchase orders**. Under **New purchase order** choose the supplier (**Choose a supplier**), the **Delivery date** and the **Terms** (for example 30 days).",
        "Press **Create and add lines**.",
        "For each line choose the **Item**, type the **Qty** and **Unit price (AED)**, and press **Add line**. For something that is not a stock item, tick **Not a stock item (describe it)** and type a description.",
        "If the part is for a job, choose it under **For job**. Parts ordered for a job go to that job first when they arrive.",
        "Check the **Total** and press **Submit for approval**.",
      ] },
      { h: "Approval", steps: [
        "The order goes to the approver for its amount (set in Approval workflows). They approve it in Approvals.",
        "Once approved, send the order to the supplier yourself. Changing a line after approval sends the order back for approval.",
        "**Cancel order** stops an order that is no longer needed.",
      ] },
      { h: "Receive the goods", steps: [
        "When the delivery arrives, open the order and go to **Goods received**.",
        "For each line type the **Good qty received** and any **Damaged (not taken)**.",
        "Type the **Supplier delivery note** number.",
        "Press **Receive into stock**. The parts are added to stock. **Still to come** shows what is still owed.",
      ] },
    ],
  },
  {
    slug: "supplier-bills", group: "Purchasing", title: "Supplier bills",
    summary: "Enter the supplier's invoice and match it to what you received.", who: "Purchasing officer, accountant",
    access: ["purchasing", "accounting"], open: { label: "Open Supplier bills", href: "/purchasing/bills" }, flows: ["purchase"],
    parts: [
      { h: "Enter a bill", steps: [
        "Open **Purchasing, Supplier bills**. Under **Enter a bill from**, choose the supplier and press **Next**.",
        "Type the **Supplier invoice no.** and **Invoice date** exactly as on their invoice.",
        "**Received and not yet billed** lists the goods received from them. Type the **Billed qty** and **Bill unit price** for each line on the invoice.",
        "Add anything that is not stock (for example delivery charges) under **Other lines (not stock)** with its **Expense type**.",
        "Press **Save and match**.",
      ] },
      { h: "Matching", steps: [
        "If the bill agrees with what was received, it is **Matched** and ready to pay.",
        "If quantities or prices differ, it goes to the accountant to check.",
        "The same supplier invoice number cannot be entered twice.",
        "Paying suppliers is under [Receivables, payables and supplier payments](/help/receivables-payables).",
      ] },
    ],
  },
  {
    slug: "petty-cash", group: "Purchasing", title: "Petty cash",
    summary: "Record small cash purchases with a receipt photo, and top up the box.", who: "Purchasing officer, accountant",
    access: ["purchasing", "accounting"], open: { label: "Open Petty cash", href: "/purchasing/petty-cash" },
    parts: [
      { h: "Record a purchase", steps: [
        "Open **Purchasing, Petty cash** and go to **Record a purchase**.",
        "Fill in the **Shop or supplier**, **What was bought**, **Expense type** and **Amount before VAT**, and the **VAT** on the receipt.",
        "If the receipt shows the shop's TRN, type it in **Their TRN (if on the receipt)**.",
        "Take a photo of the receipt and attach it in **Receipt photo (required)**.",
        "Press **Save**. The **Balance AED** of the box goes down.",
      ] },
      { h: "Top up the box", steps: [
        "Under **Top up the box**, type the amount and press **Top up**.",
      ] },
    ],
  },

  // ---------------- Billing ----------------
  {
    slug: "buy-for-job", group: "Purchasing", title: "Buying a part for one job",
    summary: "A part bought from a local shop for one car goes on the job at cost, never into stock.", who: "Stock keeper, purchasing, branch manager",
    access: ["purchasing"], open: { label: "Open Buy for a job", href: "/purchasing/direct" },
    parts: [
      { h: "Record the purchase", steps: [
        "Open **Purchasing, Buy for a job**. Choose the **Job card** and press **Choose**.",
        "Under **For which line**, choose the job line the part is for. A manager or advisor can choose **New line on the job** instead; the customer then approves it like other extra work.",
        "Type the **Part bought**, the **Shop or supplier**, and their **TRN** if it is on the receipt.",
        "Type the **Cost before VAT** and the **VAT**. VAT can be claimed only with the shop's TRN.",
        "For a new line, type the **Price to the customer**. Leave it empty to charge the cost.",
        "Take a photo of the receipt and press **Add to the job at cost**.",
      ], tips: [
        "The money comes out of petty cash, so the box must hold enough.",
        "The cost stays on the job until it is invoiced, then it goes to cost of sales. A job with a part bought for it cannot be cancelled.",
      ] },
    ],
  },
  {
    slug: "invoicing", group: "Billing", title: "Invoicing a job",
    summary: "Bill the work on a job card to the customer, a company, or a warranty claim.", who: "Service advisor, cashier",
    access: ["invoices"], open: { label: "Open Invoices", href: "/invoices" }, flows: ["customer-visit"],
    parts: [
      { h: "Prepare the invoice", steps: [
        "When the job is **Ready**, open the job card and press **Prepare invoice**.",
        "Tick the lines to bill now. Normally that is all of them.",
        "Choose **Bill to**: the customer, a fleet or company account (**Fleet account**), or a warranty claim.",
        "For a company that asks for an LPO, the LPO number must be on the job first.",
        "For a warranty claim, type the maker's or supplier's **Claim reference**. No tax invoice is made; the parts cost goes to warranty.",
        "Type a **Note printed on the invoice** if needed.",
        "Check the totals and **Checks** box, then press **Post invoice**. The invoice gets its number and the job becomes **Invoiced**.",
      ], tips: [
        "A buyer without a TRN, or an invoice of AED 10,000 or less, gets a simplified tax invoice. This is automatic.",
        "Deposits taken on this job are used automatically.",
        "If part of the job was billed earlier, the button says **Invoice the rest**.",
      ] },
      { h: "Print or send the invoice", steps: [
        "On the invoice press **Print or save as PDF**. The print has the QR code, the amount in words and the Arabic title.",
        "To send it by WhatsApp, press **Prepare WhatsApp**, send it, and press **Mark as sent**. The customer's link opens the invoice without signing in.",
      ] },
      { h: "Find an invoice", steps: [
        "Open **Billing, Invoices**. Search by invoice, customer or job number, and use **Show** to choose open or all invoices.",
      ] },
    ],
  },
  {
    slug: "payments", group: "Billing", title: "Taking a payment",
    summary: "Record cash, card, bank transfer or cheque payments against an invoice.", who: "Cashier, service advisor",
    access: ["invoices"], open: { label: "Open Invoices", href: "/invoices" }, flows: ["customer-visit", "cash-day"],
    parts: [
      { h: "Record a payment", steps: [
        "Open the invoice. Under **Record payment**, choose the **Method**: cash, card, bank transfer or cheque.",
        "Type the **Amount (AED)**. Leave it blank to pay the whole balance.",
        "For card or transfer, type the card slip or transfer **Reference**.",
        "For a cheque, the **Cheque number**, **Bank** and **Cheque date** are required.",
        "Press **Record payment**. A receipt is made and the balance goes down.",
      ], tips: [
        "If the customer pays more than the balance, the rest is held on their account for later.",
        "A post-dated cheque stays on hand until its date (see [Cheques](/help/cheques)).",
      ] },
      { h: "Use money already held for the customer", steps: [
        "If the customer has a deposit, overpayment or credit at this branch, **Use money held for the customer** is shown.",
        "Choose it, type the amount and press **Apply**.",
      ] },
    ],
  },
  {
    slug: "advances", group: "Billing", title: "Deposits (advances)",
    summary: "Take money before the job is finished. It is used when the job is invoiced.", who: "Cashier, service advisor",
    access: ["invoices"], open: { label: "Open Advances", href: "/billing/advances" },
    parts: [
      { h: "Take a deposit", steps: [
        "On the job card press **Take deposit**, or open **Billing, Advances** and find the customer by mobile or name.",
        "Choose the job if there is one.",
        "Type the **Amount incl. VAT (AED)** and choose the **Method**. For a cheque, fill in the **Cheque details**.",
        "Press **Receive deposit**. A receipt is made.",
        "When the job is invoiced, the deposit is used automatically. The list shows what is **Taken** and what is **Left**.",
      ] },
    ],
  },
  {
    slug: "counter-sale", group: "Billing", title: "Counter sale (selling parts over the counter)",
    summary: "Sell parts without a job card and take the payment in one step.", who: "Cashier, service advisor",
    access: ["invoices"], open: { label: "Open Counter sale", href: "/billing/counter-sale" }, flows: ["counter-sale"],
    parts: [
      { h: "Make the sale", steps: [
        "Open **Billing, Counter sale**.",
        "Find the customer by mobile or name and press **Find**, or press **Walk-in instead** for someone without an account. A walk-in must pay in full.",
        "Choose each item (**Choose an item**) and type the **Qty**. The **Price incl. VAT** comes from the customer's price level. **Free stock** shows what you can sell.",
        "Type a **Discount (AED)** if allowed. Above your limit, or below the minimum price, the manager must override.",
        "Under **Payment** choose the **Method** and **Amount** (blank means the whole sale). For card or transfer type the reference; for a cheque the cheque details.",
        "Press **Post sale**. The invoice and receipt are made together. Print it for the customer.",
      ] },
    ],
  },
  {
    slug: "credit-notes", group: "Billing", title: "Credit notes (returns and corrections)",
    summary: "Reduce an invoice when parts come back or a price was wrong.", who: "Cashier, branch manager",
    access: ["invoices"], open: { label: "Open Credit notes", href: "/billing/credit-notes" }, flows: ["credit-note"],
    parts: [
      { h: "Make a credit note", steps: [
        "Open the invoice and press **Credit note**.",
        "For each line, type the **Credit qty**, or a lower amount in **Or amount before VAT**.",
        "For goods, choose **Back into stock** if the part can be sold again, or **Returned, scrapped** / **No goods back**.",
        "Choose the **Reason**. For Other, type a note.",
        "Press **Create credit note**. It goes to the branch manager.",
      ] },
      { h: "After approval", steps: [
        "When approved, the credit note gets its number and can be printed.",
        "If the invoice was already paid, the credit is held for the customer. Use it on another invoice, or refund it outside the system.",
      ] },
    ],
  },
  {
    slug: "cheques", group: "Billing", title: "Customer cheques",
    summary: "Track cheques on hand, and mark them cleared or returned.", who: "Cashier, accountant",
    access: ["invoices"], open: { label: "Open Cheques", href: "/billing/cheques" }, flows: ["cheque"],
    parts: [
      { h: "Follow a cheque", steps: [
        "Open **Billing, Cheques**. Each cheque shows the customer, amount, **Cheque date** and **Status**.",
        "When the bank clears it, press **Cleared**. The money moves to the bank.",
        "If it bounces, type the **Reason returned** and press **Returned**. The invoice is open again, and a closed job goes back to Invoiced. Follow up with the customer.",
      ] },
    ],
  },
  {
    slug: "cash-closing", group: "Billing", title: "Cash closing at the end of the day",
    summary: "Count your drawer and have it signed off by the manager.", who: "Cashier, branch manager",
    access: ["invoices"], open: { label: "Open Cash closing", href: "/billing/cash" }, flows: ["cash-day"],
    parts: [
      { h: "Close your cash (cashier)", steps: [
        "At the end of your shift open **Billing, Cash closing**. It shows the **Cash taken by you today**.",
        "Type your **Opening float (AED)** and any **Cash handed over during the day (AED)**.",
        "Under **How many of each note and coin (AED)**, count the drawer and type how many of each note and coin.",
        "Type the **Card terminal batch total (AED)** from the card machine.",
        "If the count is different from what is expected by more than the allowed amount, type a **Note** to explain.",
        "Press **Close my cash**. You cannot take more cash that day.",
      ] },
      { h: "Sign off (branch manager)", steps: [
        "Open **Billing, Cash closing**. **Closings** lists each cashier's count, **Expected** and **Difference**.",
        "Check the cash, type a **Sign-off note** if needed, and press **Sign off**. You cannot sign off your own closing.",
        "Any difference is booked to cash over and short.",
      ] },
    ],
  },

  // ---------------- Accounting ----------------
  {
    slug: "statements", group: "Accounting", title: "Financial statements",
    summary: "Trial balance, profit and loss, balance sheet and cash flow, with drill-down.", who: "Accountant, owner, branch manager",
    access: ["accounting"], open: { label: "Open Financial statements", href: "/accounts" },
    parts: [
      { h: "View a statement", steps: [
        "Open **Accounting, Financial statements**. Choose the tab: trial balance, P&L, balance sheet or cash flow.",
        "Choose the **Branches** (one, several, or the company) and dates (**From** and **As on**), and press **Show**.",
        "Press any amount to see the ledger behind it, then a journal, then the original document.",
        "**Print or PDF** prints the statement.",
      ], tips: ["Branch managers see their own branches only. If you cannot see bank balances, the balance sheet and cash flow are not shown to you."] },
    ],
  },
  {
    slug: "vouchers", group: "Accounting", title: "Ledgers, day book and vouchers",
    summary: "Look up any ledger, and post journal, payment, receipt and contra vouchers.", who: "Accountant",
    access: ["accounting"], open: { label: "Open Ledgers and vouchers", href: "/accounts/ledger" },
    parts: [
      { h: "Look up a ledger", steps: [
        "Open **Accounting, Ledgers and vouchers**. Choose the **Ledger**, branch and dates. It shows the opening balance, every entry and the running balance.",
        "The **Day book** tab lists every journal between two dates.",
      ] },
      { h: "Post a voucher", steps: [
        "On the Vouchers tab press **New voucher**.",
        "Choose the **Type**: journal, payment, receipt, contra, debit note or credit note. Set the **Date**.",
        "Add lines: choose the **Ledger** and type the **Debit** or **Credit**. A receivable or payable line must name the **Customer or supplier**.",
        "Type the **Narration (what it is for)**. Debits must equal credits.",
        "Press **Submit for approval**. The voucher gets its number when it is approved and posted.",
      ] },
    ],
  },
  {
    slug: "receivables-payables", group: "Accounting", title: "Receivables, payables and supplier payments",
    summary: "Who owes us, whom we owe, statements, and paying supplier bills.", who: "Accountant",
    access: ["accounting"], open: { label: "Open Payables and payments", href: "/accounts/payables" }, flows: ["purchase"],
    parts: [
      { h: "Receivables and statements", steps: [
        "Open **Accounting, Receivables**. It shows each customer's balance by age, their **Credit limit** and what is **Overdue**.",
        "Press a customer for their statement. **Print or PDF** to send it.",
      ] },
      { h: "Pay a supplier", steps: [
        "Open **Accounting, Payables and payments** and press **Pay a supplier**.",
        "Choose the **Supplier** and press **Show open bills**.",
        "Choose the **Method**: **Bank transfer** (with the **From bank account** and **Transfer reference**), **Cheque** (with **Cheque no.** and **Cheque date**) or **Cash (petty cash)**.",
        "Type the amount against each bill under **Open bills**, or leave it blank to pay as much as possible.",
        "Press **Post payment**.",
        "Money paid on account earlier can be used against a bill with **Use against bill**.",
      ] },
      { h: "Issued cheques", steps: [
        "On the payments list, press **Paid by bank** when the bank pays a cheque you issued.",
        "If a cheque is cancelled, type **Why cancelled** and press **Cancel**. The payment is reversed and the bills open again.",
      ] },
    ],
  },
  {
    slug: "bank", group: "Accounting", title: "Bank, card settlements and reconciliation",
    summary: "Post card settlements, import bank statements and reconcile.", who: "Accountant",
    access: ["accounting"], open: { label: "Open Bank & reconciliation", href: "/accounts/bank" },
    parts: [
      { h: "Card settlements", steps: [
        "Open **Accounting, Bank & reconciliation**. **Card receipts waiting at this branch** shows card money not yet in the bank.",
        "Under **Card settlement** choose the **Batch**, type the **Bank credit (AED)** and **Commission**, and the **Bank account credited**.",
        "Press **Post settlement**.",
      ] },
      { h: "Reconcile a bank statement", steps: [
        "Download the statement from online banking as CSV.",
        "Under **Import a bank statement**, choose the **Bank account**, attach the **File** (or paste the CSV), and type the **Closing balance on the statement**.",
        "Press **Import and match**. Lines are matched by amount, date and reference.",
        "Open the statement. For a line **Not matched**, press **Match** and choose the book entry, or **Post entry** to post a bank charge directly.",
        "When the **Balance in the books** agrees with the **Balance the bank should show**, press **Finish and lock**.",
      ] },
    ],
  },
  {
    slug: "vat", group: "Accounting", title: "VAT return",
    summary: "The VAT 201 boxes with the documents behind them and the FTA audit file.", who: "Accountant",
    access: ["accounting"], open: { label: "Open VAT return", href: "/accounts/vat" },
    parts: [
      { h: "Prepare the return", steps: [
        "Open **Accounting, VAT return**. Choose the period (**From** and to) and **Whole company** or **Current branch only**, and press **Show**.",
        "The VAT 201 boxes are filled in. Press a box to see every document behind it.",
        "Check the **Ledger check** line: the VAT accounts in the ledger must agree.",
        "Type the figures into the FTA portal yourself.",
        "Press **FTA audit file (CSV)** if the FTA asks for the audit file.",
      ] },
    ],
  },
  {
    slug: "month-end", group: "Accounting", title: "Month end, year end and other accounting tasks",
    summary: "Close a month, close the year, head-office allocation, fixed assets, budgets and the opening from Tally.", who: "Accountant, owner",
    access: ["accounting"], open: { label: "Open Month end", href: "/accounts/periods" }, flows: ["month-end"],
    parts: [
      { h: "Close a month", steps: [
        "Open **Accounting, Month end**. Each month shows its checklist: cash sessions signed off, bank statements finished, stock counts closed, vouchers and bills posted, and the VAT tick.",
        "Fix anything not ticked. Months close in order, oldest first.",
        "Press close on the month. A closed month refuses any new posting.",
        "Only the owner can **Reopen** a closed month, with a **Reason for reopening**.",
      ] },
      { h: "Close the year", steps: [
        "After the last month is closed, press **Close the year**. The profit moves to retained earnings.",
      ] },
      { h: "Head-office cost allocation", steps: [
        "Open **Allocation**. Choose the **Month**, and the split by **Revenue** or fixed **Share**. Press **Preview**, then **Post allocation**.",
      ] },
      { h: "Fixed assets", steps: [
        "Open **Assets**. Press **Add an asset** with its **Name**, **Category**, **Cost (AED, before VAT)**, **Bought on**, **Useful life (months)** and **Value at the end of its life**, and how it was paid.",
        "Each month press **Run depreciation**. To sell or scrap an asset, press **Dispose** with the amount received.",
      ] },
      { h: "Budgets", steps: [
        "Open **Budgets**, choose **Enter budgets**, type the budget by ledger and month, and press **Save budgets**. **Budget against actual** shows the variance.",
      ] },
      { h: "Opening balances from Tally (one time)", steps: [
        "Open **Month end, Opening**. **Step 1 · Import masters from Tally**: attach the masters CSV and press **Import**.",
        "Step 2: attach the ledger balances, open bills and Tally trial balance CSVs with the **Cut-over date**. The check lists every problem without saving anything.",
        "Step 3: press **Load the opening balances**.",
        "Step 4: when **The opening trial balance agrees with Tally**, the accountant presses **Sign off**.",
      ] },
    ],
  },

  // ---------------- HR ----------------
  {
    slug: "my-hr", group: "HR", title: "My HR (for every employee)",
    summary: "Check in, apply for leave, see payslips, ask for letters and advances.", who: "Every employee",
    access: ["all"], open: { label: "Open My HR", href: "/me" }, flows: ["leave"],
    parts: [
      { h: "Check in and out", steps: [
        "Open **HR, My HR** and press **Check in or out now**.",
        "Allow the phone to share your location. You must be inside the branch area. Press **Check in or out here**.",
        "Or scan the branch QR code on the wall with your phone camera.",
        "**My week** shows your times and any late minutes.",
      ] },
      { h: "Apply for leave", steps: [
        "Under **Apply for leave**, choose the **Leave** type, the **From** date and the **Days**, and a **Reason (optional)**.",
        "Press **Send to my manager**. It goes to your line manager, then HR.",
        "**Leave balances** shows what you have left. **My leave requests** shows the status. You can **Cancel** a request that is still waiting.",
      ] },
      { h: "Payslips, documents and letters", steps: [
        "**My payslips** lists each month. Press one to open it and print it.",
        "**My documents** shows your passport, visa and other documents with their expiry dates.",
        "To ask for a letter (salary certificate and so on), choose the **Letter**, the **Language** (English or Arabic) and **Addressed to (optional)**, and press **Ask HR**.",
      ] },
      { h: "Ask for a salary advance or loan", steps: [
        "Under **Salary advance or loan**, choose the type, the **Amount (AED)**, the **Months to repay** and the **First deduction** month, and a reason.",
        "Send it. It is repaid from your salary after approval.",
      ] },
    ],
  },
  {
    slug: "employees", group: "HR", title: "Employee files",
    summary: "Add an employee, keep documents and records, and handle salary, transfers and leaving.", who: "HR",
    access: ["hr"], open: { label: "Open Employees", href: "/hr/employees" }, flows: ["hire"],
    parts: [
      { h: "Add an employee", steps: [
        "Open **HR, Employees** and press **New employee**.",
        "**Personal**: first and last name, name in Arabic, nationality, date of birth, gender, marital status, mobile, email, emergency contact.",
        "**Job**: branch, department, designation, grade, line manager, joining date, contract (Limited or Unlimited), contract end, probation end, shift and weekly day off.",
        "**Labour and WPS**: MOHRE person code, labour card no., WPS agent, how they are paid (bank account IBAN or WPS salary card) and the number.",
        "Link a **Sign-in user** if they will use Superfix.",
        "Press **Add employee**. The employee number is given automatically.",
      ] },
      { h: "Documents and records", steps: [
        "Open the employee and press **Documents and records**.",
        "Each record type has its own section: documents (passport, visa, Emirates ID, labour card), insurance, air ticket, visa process, assets issued, disciplinary warnings, reviews and training.",
        "Fill in the fields, attach a photo or PDF in **File (optional)**, and press **Save**.",
        "Documents near expiry show on the HR dashboard.",
      ] },
      { h: "Renew a visa or document before it expires", steps: [
        "Documents and visas that expire within 60 days are listed on the **HR dashboard** under **Expiring documents and visas**. Those within 30 days also show in the bell at the top.",
        "When the PRO starts the renewal, press **Start renewal**. It shows **Started** with the date and your name, and the bell stops reminding.",
        "When the new visa or document is in hand, type the **New expiry date** and press **Renewed**. The new date replaces the old one, and the change is kept in the audit log.",
        "To keep a copy of the new document, add it on the employee's **Documents and records** with the file.",
      ] },
      { h: "Salary", steps: [
        "On the **Salary** tab, press **Update salary**, type each component's new monthly amount and the **From date**, and press **Send for approval**.",
      ] },
      { h: "Checklists, transfers and leaving", steps: [
        "**Checklists**: tick the joining checklist items as they are done.",
        "**Transfers**: choose **To branch**, the **Effective** date and reason, and press **Transfer**.",
        "When someone leaves, press **Start leaving checklist**, then **Prepare final settlement** (see [Final settlement](/help/settlements)).",
      ] },
    ],
  },
  {
    slug: "attendance", group: "HR", title: "Attendance & roster",
    summary: "Punching machines, missing punches, imports and the weekly roster.", who: "HR, branch manager",
    access: ["hr"], open: { label: "Open Attendance & roster", href: "/hr/attendance" },
    parts: [
      { h: "See attendance", steps: [
        "Open **HR, Attendance & roster**. Choose the branch and date and press **Show**. Each person's in, out, hours and **Late** minutes are shown.",
      ] },
      { h: "Fix a missing punch", steps: [
        "When someone punched in but not out, the day shows under **Missing punches to fix** at the top of Attendance (last 7 days), and in the bell for HR and the branch manager.",
        "Ask the employee what time they left. Type the **Time out**, change the reason if needed, and press **Fix**. It is saved as a punch added by hand, with your name.",
      ] },
      { h: "Punching machines (biometric sync)", steps: [
        "Open **HR, Punching machines**. Each machine shows **Online** or **Offline**, its last sync and today's punches. A machine that has sent nothing for 30 minutes shows **Offline**, and the bell tells HR.",
        "To add a machine, choose the **Branch**, type a **Machine code** (for example YAS-ZK2), a **Name** and the **Model**, and press **Add machine**.",
        "Press **Make key**. The key is shown once: type it into the machine's cloud or push settings (or the sync program on the branch PC). From then on the machine sends its punches by itself.",
        "If the key was seen by someone else, press **New key**: the old key stops working. **Switch off** stops a machine sending.",
      ] },
      { h: "Import from the biometric device", steps: [
        "If a machine cannot send by itself, export the punches from it as CSV.",
        "Under **Import from the biometric device**, type the **Device** name, attach the **File** and press **Import**.",
      ] },
      { h: "Add a punch by hand", steps: [
        "Under **Add a punch by hand**, choose the **Employee**, **Date** and **Time**, type **Why by hand** (for example forgot to punch) and press **Add punch**.",
      ] },
      { h: "Branch QR code", steps: [
        "Press **Branch QR code** and print it. Put it on the wall. Staff scan it to check in.",
      ] },
      { h: "Roster", steps: [
        "Open the roster. For each employee choose the shift or **Day off** for each day of the week.",
        "Use **Previous week** and **Next week** to move. Press **Save roster**.",
      ] },
    ],
  },
  {
    slug: "leave", group: "HR", title: "Leave and overtime (HR and managers)",
    summary: "Apply leave for staff, approve requests, and record overtime.", who: "HR, line managers",
    access: ["hr"], open: { label: "Open Leave and overtime", href: "/hr/leave" }, flows: ["leave"],
    parts: [
      { h: "Leave", steps: [
        "Open **HR, Leave and overtime**. The list shows every request with its status.",
        "To apply for someone, use **Apply for leave for an employee**: choose the employee, leave type, from date and days, and press **Send for approval**.",
        "Requests go to the line manager, then HR, in Approvals.",
        "To correct a balance, open the employee's **Leave** tab, **Adjust a balance**, type the days (minus to take off) and a reason, and press **Save adjustment**.",
      ] },
      { h: "Overtime", steps: [
        "Open **Overtime**. Under **Record overtime worked**, choose the employee, the **Day worked**, **Hours**, **Type** (normal, night, rest day or holiday) and **What for**.",
        "Press **Send for approval**. Only approved overtime is paid in payroll.",
      ] },
    ],
  },
  {
    slug: "letters", group: "HR", title: "HR letters",
    summary: "Salary certificates, salary transfer, experience and employment letters.", who: "HR",
    access: ["hr"], open: { label: "Open Letters", href: "/hr/letters" },
    parts: [
      { h: "Prepare a letter", steps: [
        "Open **HR, Letters**. Under **Prepare a letter**, choose the **Employee**, the **Letter** type and **Language**, and type **Addressed to** (or leave it as To whom it may concern).",
        "Press **Send for approval**. Once approved it gets a reference number.",
        "Open the letter and press **Print or save as PDF**.",
        "Requests from employees (from My HR) are in the same list.",
      ] },
    ],
  },
  {
    slug: "recruitment", group: "HR", title: "Recruitment",
    summary: "Openings, applicants, interviews, offers and hiring.", who: "HR",
    access: ["hr"], open: { label: "Open Recruitment", href: "/hr/recruitment" }, flows: ["hire"],
    parts: [
      { h: "Openings and applicants", steps: [
        "Open **HR, Recruitment**. Under **New opening**, type the **Job title**, **Branch**, department, designation and **Positions**, and press **Add opening**.",
        "Under **Add applicant**, choose the opening and type the **Full name**, mobile, email and nationality, and press **Add applicant**.",
        "Move each applicant through the **Stage**: Interview, **Offer** (with the offer amount), then **Hire** or **Not taken**, with notes.",
        "**Hire** asks for the **Joining date** and opens a new employee file with their details.",
      ] },
    ],
  },

  // ---------------- Payroll ----------------
  {
    slug: "payroll", group: "Payroll", title: "Monthly payroll",
    summary: "Calculate, check, approve, post, make WPS files and mark paid.", who: "HR / payroll, owner",
    access: ["payroll"], open: { label: "Open Payroll runs", href: "/payroll" }, flows: ["payroll"],
    parts: [
      { h: "Before payroll", steps: [
        "Make sure attendance is imported, leave and overtime are approved, and salary updates and loans are approved for the month.",
      ] },
      { h: "Calculate the month (HR)", steps: [
        "Open **Payroll, Payroll runs**. Choose the **Month** and press **Calculate**.",
        "Open the month. Check each employee's days, gross, deductions and net. The check column compares with **Last month** and flags changes.",
        "If you fix something (for example approve late overtime), press **Recalculate**.",
        "Send it to the owner for approval.",
      ] },
      { h: "Approve (owner)", steps: [
        "The owner opens the run from Approvals and approves it. The month is now locked and the salary cost is posted to each branch.",
        "If a mistake is found, the owner can **Reopen** it with a reason.",
      ] },
      { h: "Pay", steps: [
        "Under **WPS salary files**, download the SIF file for each agent and upload it to the bank or exchange yourself.",
        "When the bank has paid, choose the **Paid from bank** account and press **Mark paid**.",
        "Payslips appear in each employee's My HR. The **Branch register** has every salary component by branch and can be downloaded with **Download CSV**.",
      ] },
    ],
  },
  {
    slug: "salary-loans", group: "Payroll", title: "Salary updates, advances and loans",
    summary: "Change salaries and give advances or loans, with approval.", who: "HR / payroll",
    access: ["payroll"], open: { label: "Open Salary updates", href: "/payroll/revisions" },
    parts: [
      { h: "Update a salary", steps: [
        "Open **Payroll, Salary updates**. Choose the employee, each component's **New monthly amount (AED)**, the **From** month and the **Reason** (for example annual increment 2027).",
        "Press **Send for approval**. It applies from that month once approved.",
      ] },
      { h: "Advances and loans", steps: [
        "Open **Payroll, Advances and loans**. Under **New advance or loan for an employee**, choose the employee and type (**Salary advance** or **Loan**), the **Amount (AED)**, **Months to repay** and **First deduction**.",
        "Press **Send for approval**. Instalments are taken in each payroll, within the deduction limit. **Recovered** and **Left** show progress.",
        "**Payroll, Liabilities** shows the gratuity owed and the loans to recover by branch.",
      ] },
    ],
  },
  {
    slug: "settlements", group: "Payroll", title: "Final settlement (end of service)",
    summary: "Work out gratuity, leave pay and loans when someone leaves.", who: "HR / payroll, owner",
    access: ["payroll"], open: { label: "Open Final settlements", href: "/payroll/settlements" },
    parts: [
      { h: "Prepare a settlement", steps: [
        "Open **Payroll, Final settlements** and press **New settlement** (or **Prepare final settlement** on the employee).",
        "Choose the **Employee**, the **Last working day** and the **Reason** (resignation, termination and so on).",
        "Add **Notice pay in lieu (days, optional)** and **Other deductions (AED, optional)** with what they are for.",
        "Press **Show the figures**. The **Settlement statement** shows gratuity, unused leave, open loans and the **Net payable**.",
        "Press **Send to owner for approval**. Once approved, print it for the employee to sign.",
      ] },
    ],
  },

  // ---------------- Reports ----------------
  {
    slug: "reports", group: "Reports", title: "Reports, exports and the report inbox",
    summary: "The dashboard, 35 standard reports, filters, Excel, copies, pins and schedules.", who: "Managers, accountant, HR",
    access: ["reports"], open: { label: "Open Reports dashboard", href: "/reports" },
    parts: [
      { h: "The reports dashboard", steps: [
        "Open **Reports, Reports dashboard**. It shows today and the chosen period by branch: sales, cars in and out, cash, late jobs, receivables and the enquiry funnel.",
        "Choose **Period from** and to, and the branches, and press **Show**. Press any figure to see the list behind it.",
      ] },
      { h: "Run a report", steps: [
        "Open **Reports, All reports** and press the report you need (for example TR-02 sales).",
        "Set the filters: branches, dates, advisor, technician. Press **Show**.",
        "Choose **Data: Live** for current records, or **Archived** for old ones.",
        "Press **Excel** or **CSV** to download, or **Print or PDF** to print on the letterhead.",
        "**Reset the filters** goes back to the standard view.",
      ] },
      { h: "Save your own copy", steps: [
        "On a report, open **Save a copy of this report**. Tick the columns to **Keep**, change their **Name** and **Order**, and press **Save copy**.",
        "Your copy is under **Saved and shared reports**. You can **Share** it with roles or users, add it to the menu, or delete it.",
      ] },
      { h: "Pin to your dashboard", steps: [
        "On a report choose **Show as** table or chart, type a **Title**, and press **Pin**. It appears under **My pinned reports**. **Unpin** removes it.",
      ] },
      { h: "Get a report every day, week or month", steps: [
        "On a report choose **How often** (**Daily (yesterday)**, **Weekly (last 7 days)** or **Monthly (last month)**) and press **Schedule**.",
        "The Excel file appears in **Reports, Report inbox**. Press **Download Excel**. Nothing is emailed.",
        "**Stop** ends a schedule. **Prepare now** makes one straight away.",
      ] },
    ],
  },
  {
    slug: "report-builder", group: "Reports", title: "Report builder",
    summary: "Build your own report with columns, filters, totals, a pivot and a chart.", who: "Managers, accountant",
    access: ["reports"], open: { label: "Open Report builder", href: "/reports/builder" },
    parts: [
      { h: "Build a report", steps: [
        "Open **Reports, Report builder**. Choose the **Data source** (for example invoices or job cards) and press **Next**.",
        "**Columns**: tick the columns. For numbers choose a total, count or average.",
        "**Filters**: add conditions, or leave a value empty so it is asked each time the report runs. Choose a **Date filter**.",
        "**Sort and subtotals**: choose **Sort by**, **Highest first** or **Lowest first**, and **Subtotal by**.",
        "**Pivot** (optional): choose rows, columns and the value to summarise.",
        "**Calculated columns** (optional): for example amount times a rate.",
        "**Chart**: **Bar**, **Line**, **Pie** or **No chart**, with labels and values.",
        "Press **Preview**. When it looks right, type the **Report name** and save it.",
      ] },
    ],
  },
  {
    slug: "archive", group: "Reports", title: "Archive",
    summary: "Move old closed records to the read-only archive every six months.", who: "Owner",
    access: ["reports"], open: { label: "Open Archive", href: "/reports/archive" },
    parts: [
      { h: "Run the archive", steps: [
        "Open **Reports, Archive**. It shows **The next run is due on** and which records would move.",
        "Press **Run the archive now**. Closed, paid and posted records older than 12 months become read only.",
        "Customers, vehicles, items, suppliers, staff and settings are never archived.",
        "In any report, choose **Data: Archived** to see archived records.",
      ] },
    ],
  },

  // ---------------- Administration ----------------
  {
    slug: "users", group: "Administration", title: "Users and access",
    summary: "Create users, give them a role at each branch, reset passwords, disable users.", who: "Administrator",
    access: ["admin"], open: { label: "Open Users & access", href: "/admin/users" },
    parts: [
      { h: "Create a user", steps: [
        "Open **Administration, Users & access**. Under **New user**, type the **User name**, **Full name**, **Mobile** and a **Password (8+)**.",
        "Choose the **Default branch** and press **Create**. Give the password to the person privately.",
      ] },
      { h: "Give or change access", steps: [
        "Under **Give or change access**, choose the user, the branch (or **ALL branches**) and the role, and press **Set**.",
        "A user can have a different role at each branch. **Access (branch: role)** shows what they have.",
      ] },
      { h: "Reset a password or disable a user", steps: [
        "Type a **New password** and press **Reset**.",
        "When someone leaves, press **Disable user**. They can no longer sign in, and their history is kept.",
      ] },
    ],
  },
  {
    slug: "roles-admin", group: "Administration", title: "Roles and permissions",
    summary: "What each role can see and do, and who sees prices and costs.", who: "Administrator",
    access: ["admin"], open: { label: "Open Roles & permissions", href: "/admin/roles" },
    parts: [
      { h: "Change a role", steps: [
        "Open **Administration, Roles & permissions** and press **Edit** on the role.",
        "For each **Screen**, tick the actions: view, create, edit, approve, cancel and export.",
        "Under **Field permissions (who sees prices and costs)**, set each **Field group** to **Hidden**, **View** or edit.",
        "Save. It applies the next time those users open a page.",
        "To make a new role, type a code (for example cashier) and **Name** and press **Add role**.",
      ] },
    ],
  },
  {
    slug: "setup", group: "Administration", title: "Branches, master forms, workflows, numbering and settings",
    summary: "Set up the lists, approval rules, document numbers and settings the system uses.", who: "Administrator",
    access: ["settings", "admin"], open: { label: "Open Master forms", href: "/admin/masters" },
    parts: [
      { h: "Branches", steps: [
        "**Administration, Branches**: type the **Code** (for example ABC), **Name**, **Name (Arabic)**, **Emirate**, **Type** (workshop, warehouse, head office) and **WhatsApp number**, and press **Add branch**.",
      ] },
      { h: "Master forms", steps: [
        "**Administration, Master forms** holds every list: services and labour rates, parts, suppliers, tax codes, payment methods, pick lists, bays, technician capacity, message templates, the chart of accounts, posting rules, leave types, letters and employee custom fields.",
        "Open a list, press **Add** to add a row or **Edit** to change one. Untick **Active** to stop using a row without deleting it.",
      ] },
      { h: "Service bundles", steps: [
        "Open **Administration, Service bundles** and press **New bundle**, or **Change** on a bundle.",
        "Type the **Code**, the **Name**, and in **For vehicles** the make, model or size it fits (for example Toyota Land Cruiser). Matching cars see it first.",
        "On each line choose **Labour** or **Part**, the service or part, and the **Qty**. For labour, Qty is how many times it is done (for example 4 tyres fitted).",
        "Press **Save bundle**. Prices are not kept in the bundle; they come from the service and part lists when the bundle is added.",
      ] },
      { h: "Approval workflows", steps: [
        "**Administration, Approval workflows**: for each document, set the **Step**, the **Approver**, the amount band (**From AED**, **To AED**) or **Discount above %**, and press **Save**.",
      ] },
      { h: "Document numbering", steps: [
        "**Administration, Document numbering**: filter by branch, then set each document's prefix, next number, padding and year part, and press **Save**.",
      ] },
      { h: "Settings", steps: [
        "**Administration, Settings**: discount limits, minimum margin, quotation validity, sign-in, booking capacity, service intervals, payroll and WPS values, archive timing and e-invoicing. Change a value and press **Save**. Every change is audited.",
      ] },
    ],
  },
  {
    slug: "audit", group: "Administration", title: "Audit log",
    summary: "See who did what, and when, and export it.", who: "Owner, administrator",
    access: ["audit"], open: { label: "Open Audit log", href: "/admin/audit" },
    parts: [
      { h: "Search the log", steps: [
        "Open **Administration, Audit log**. Filter by **User**, **Record type** (for example quotation, voucher), **Record (number or id)**, **Action** and dates, and press **Filter**.",
        "Each line shows when, the user, the role they acted in, the action and the changes.",
        "**Sign-ins and branch switches** shows who signed in and from where.",
        "Press **Export CSV** to download it.",
      ] },
    ],
  },
];

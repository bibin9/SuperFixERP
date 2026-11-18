import type { HelpTopic } from "./types";

export const FRONT: HelpTopic[] = [
  // ---------------- Getting started ----------------
  {
    slug: "sign-in", group: "Getting started", title: "Signing in and finding your way",
    summary: "Sign in, use the menu, switch branch, search, and sign out.", who: "Everyone", access: ["all"],
    parts: [
      { h: "Sign in", steps: [
        "Open the Superfix address your manager gave you in Chrome, Safari or Edge, on a computer, tablet or phone.",
        "Type your **User name** and **Password** exactly as given to you. Capital letters matter in the password.",
        "Press **Sign in**. You arrive on the **Home** page.",
        "If you forget your password, ask your administrator. They can set a new one under Users & access. There is no self-service reset.",
      ], tips: ["Do not share your user name. Everything you do is recorded under your name in the audit log."] },
      { h: "Use the menu", steps: [
        "The menu is on the left. On a phone, press **☰ Menu** at the top to open or close it.",
        "The menu is in groups: Front office, Workshop, Parts, Purchasing, Billing, Accounting, HR, Payroll, Reports, Administration and Help. Press a group name to open or close it.",
        "You only see the screens your role allows. If you need a screen you cannot see, ask your branch manager or administrator.",
        "The page you are on is highlighted in the menu.",
      ] },
      { h: "Switch branch", steps: [
        "If you work at more than one branch, a branch box is shown at the top of the page.",
        "Choose the branch. The page reloads and everything you see and create now belongs to that branch.",
        "Always check the branch before you create an enquiry, invoice or payment.",
      ] },
      { h: "Search for anything", steps: [
        "Use the search box at the top of every page.",
        "Type a plate number, mobile number, VIN, customer name, job card number, invoice number or part number, and press Enter.",
        "Press a result to open it.",
      ] },
      { h: "Get help on the screen you are on", steps: [
        "Press **Help** at the top of any page. It opens the guide for that screen.",
        "Or open **Help, User guide** in the menu to see every guide for your role.",
      ] },
      { h: "Sign out", steps: [
        "Press **Sign out** at the bottom of the menu, especially on a shared computer.",
      ] },
    ],
  },
  {
    slug: "basics", group: "Getting started", title: "Things that work the same everywhere",
    summary: "Forms and errors, approvals, WhatsApp messages, printing, history and exports.", who: "Everyone", access: ["all"],
    parts: [
      { h: "Filling in a form", steps: [
        "Fields marked (optional) can be left empty. Every other field is needed.",
        "Press the green or blue button at the bottom of the form (Save, Post, Send for approval) to save.",
        "If something is wrong, the page tells you in red under the field, outlines the field and puts what you typed back. Correct it and press the button again.",
        "Press the button only once. If the page is slow, wait. The system refuses to post the same invoice or payment twice, so a double press does no harm.",
      ] },
      { h: "Approvals", steps: [
        "Some actions need a manager first: a big discount, a price below the minimum, a purchase order over a limit, a credit note, a stock adjustment, leave, a salary change and so on.",
        "When you send something for approval, it waits in the approver's [Approvals](/approvals) inbox. You see it under **Sent by me**.",
        "The approver presses **Approve**, **Reject** or **Send back**. Rejecting or sending back needs a comment, which you will see.",
        "Each document shows its **Approval history**: who approved, when and why.",
      ] },
      { h: "WhatsApp and messages to customers", steps: [
        "Superfix never sends messages by itself. It prepares the text for you.",
        "Press **Prepare WhatsApp** (or **Prepare approval message**). The message and a link are shown.",
        "Press **Open WhatsApp** to open it in WhatsApp with the text filled in, or copy the text and send it your own way.",
        "After you have really sent it, press **Mark as sent**. This records who sent it and when.",
      ] },
      { h: "Printing and PDF", steps: [
        "Invoices, credit notes, payslips, letters and reports have a **Print or save as PDF** button.",
        "It opens your browser's print window. Choose your printer, or choose Save as PDF as the destination to keep a file.",
      ] },
      { h: "Who did what", steps: [
        "Most documents have a **History: who did what** panel at the bottom. It lists every change with the user, role and time.",
      ] },
      { h: "Phones", steps: [
        "On a phone, lists show one card per row with the column name beside each value.",
        "Photos and PDFs up to 5 MB can be attached. A bigger file is stopped with a message. Take the photo at a lower resolution, or reduce it first.",
      ] },
    ],
  },
  {
    slug: "roles", group: "Getting started", title: "Who does what (roles)",
    summary: "The jobs each role does in Superfix.", who: "Everyone", access: ["all"],
    parts: [
      { h: "Roles", intro: "Your administrator gives each user a role at each branch. The role decides the menu you see and what you may do. These are the usual jobs of each role:", steps: [
        "**Service advisor**: takes enquiries, adds customers and vehicles, makes quotations, gets the customer's approval, creates job cards, prepares invoices and takes payments.",
        "**Foreman**: runs the workshop board, assigns technicians and bays, corrects clock times, does the quality check.",
        "**Technician**: uses **My jobs** on a phone to clock in and out of work and to ask for parts.",
        "**Stock keeper**: issues parts to jobs, receives goods, transfers stock between branches, counts stock.",
        "**Purchasing officer**: raises purchase orders, receives goods, enters supplier bills.",
        "**Branch manager**: approves discounts, purchase orders, credit notes and adjustments, signs off cash closing, releases cars on credit.",
        "**Accountant**: vouchers, ledgers, supplier payments, bank reconciliation, VAT return and month end.",
        "**HR / payroll**: employee files, attendance, leave, letters, recruitment and the monthly payroll.",
        "**Owner / HQ**: sees every branch, approves payroll and final settlements, closes the year and reopens months.",
        "**Administrator**: users, roles, branches, master forms, settings and numbering.",
        "**Everyone** has **My HR** for their own leave, payslips and letters.",
      ] },
    ],
  },

  // ---------------- Front office ----------------
  {
    slug: "enquiries", group: "Front office", title: "Taking an enquiry (a customer arrives or calls)",
    summary: "Every job starts with an enquiry. Record the customer, the car and what they want.", who: "Service advisor",
    access: ["customers"], open: { label: "Open Enquiries", href: "/enquiries" }, flows: ["customer-visit"],
    parts: [
      { h: "Before you start", steps: [
        "Every visit follows the same order: **enquiry, then quotation, then the customer's approval, then the job card**. You cannot open a job card without an approved quotation.",
      ] },
      { h: "Create the enquiry", steps: [
        "In the menu open **Front office, Enquiries** and press **New enquiry**.",
        "In the customer box type the customer's name or mobile number and press **Find**. Pick the customer from the list.",
        "If the customer is new, press **New customer** and add them first (see [Adding a customer and vehicle](/help/customers)). If you only have a name and number, tick **Contact only (no customer record yet)** and fill in **Contact name** and **Contact mobile**.",
        "Choose the **Vehicle**. If the car is not there yet, choose **Not known yet**. You will need it before the job card. If the customer has no vehicle yet, press **Add one**.",
        "Choose the **Source** (walk-in, phone, WhatsApp, referral and so on).",
        "Under **Service asked about**, choose what the customer wants. Write their words in **Customer complaints** (for example \"AC not cold, noise from front left\").",
        "If the car is here, fill in the check-in: **Odometer (km)**, **Fuel level (0 to 8 eighths)** and **Valuables in the car**.",
        "If you need to call them back, set **Follow up at**.",
        "Press **Save enquiry**. The enquiry gets its number, for example YAS-ENQ-26-00012.",
      ] },
      { h: "On the enquiry page", steps: [
        "**Customer, vehicle and check-in**: change the details and press **Save**. Choose the **Job type**: Service, Repair, Recovery or Warranty comeback. For a comeback, type the **Original job no.**.",
        "For a fleet customer that uses LPOs, type the **Customer LPO no. (fleet)**.",
        "Set the **Promised delivery** date and time you agreed with the customer.",
        "Make the quotation in the work panel (see [Making a quotation](/help/quotation)).",
        "To book a time in the workshop, use the booking box (see [Booking calendar](/help/bookings)).",
        "If the car must be collected, press **Schedule a run** (see [Pickup, drop-off and recovery](/help/runs)).",
        "If the customer decides not to go ahead, press **Mark lost** and give the reason.",
      ] },
      { h: "Find an enquiry later", steps: [
        "The [Enquiries](/enquiries) list shows the number, customer, vehicle, service asked, status, follow-up time and the job card once it exists. Press the number to open it.",
        "The [Home](/) page shows quotations sent and waiting for the customer, and approved ones that still need a job card.",
      ] },
    ],
  },
  {
    slug: "customers", group: "Front office", title: "Adding a customer and vehicle",
    summary: "Create individual, company and fleet customers and add their cars.", who: "Service advisor",
    access: ["customers"], open: { label: "Open Customers & vehicles", href: "/customers" },
    parts: [
      { h: "Add an individual customer", steps: [
        "Open **Front office, Customers & vehicles** and press **New customer**.",
        "Choose **Customer type: Individual**.",
        "Choose the **Title** and type the **First name** and **Last name**. **Name in Arabic** is optional.",
        "Type the **Mobile (with or without country code)**, for example 050 123 4567.",
        "Add the email, emirate and ID if the customer gives them.",
        "Choose the **Price level** (Retail for most customers).",
        "Press **Save customer**.",
        "If the mobile or ID already belongs to someone, the page warns **Possible duplicate found in another record**. Open the existing customer instead of making a second one.",
      ] },
      { h: "Add a company, fleet or government customer", steps: [
        "Choose **Customer type: Corporate / fleet** or **Government** and type the **Company name**.",
        "For a VAT-registered company type the **TRN (VAT-registered business)**. Tax invoices to them also need the **Peppol ID**, **Trade licence no.**, **Licence issued by**, the address (**Building and street**, **City**, **Emirate**, **P.O. box**) and the **Contact phone**.",
        "If the company buys on credit, set **Payment terms (days)** and **Credit limit (AED)**. A **Fleet discount %** is applied to their quotations.",
        "Choose the price level (Trade or Fleet) and press **Save customer**.",
      ] },
      { h: "Add a vehicle", steps: [
        "Open the customer and find **Add vehicle**.",
        "Choose **Registered in** (emirate), type the **Plate code** (for example 5 or K) and **Plate number**.",
        "Choose the **Make**, **Model** and **Year**, and type the **Colour**.",
        "Type the **VIN (17 characters)** from the Mulkiya. If you cannot get it, fill in **If no VIN, reason**.",
        "Add the **Mulkiya expiry** and the current **Odometer**.",
        "Press **Add vehicle**. If the plate already belongs to another car, the page shows **Matches an existing vehicle**. Plates can move between cars, so you may save anyway with a reason.",
      ] },
      { h: "The vehicle page", steps: [
        "Press a vehicle to open its page. It shows the owner, **Call** and **WhatsApp chat** buttons, **Book a visit**, unpaid invoices (**Owes AED**), open work with the technician and status, the **Next service** due, and **Past services, all branches**.",
        "**Deferred work to offer** lists work the customer declined before, so you can offer it again.",
        "To change the service interval for this car, fill in **Every (km)** or **Every (months)** and press **Save**.",
      ] },
    ],
  },
  {
    slug: "quotation", group: "Front office", title: "Making a quotation and getting approval",
    summary: "Add labour, parts and outside work, send the approval link, and record the customer's answer.", who: "Service advisor",
    access: ["customers", "jobs"], open: { label: "Open Enquiries", href: "/enquiries" }, flows: ["customer-visit", "extra-work"],
    parts: [
      { h: "Build the quotation", steps: [
        "Open the enquiry. The work panel is in the middle of the page.",
        "Press **Add labour** for each job (for example \"60,000 km service\"). Choose the service from the list. The hours and price come from the master list.",
        "Press **Add part** and choose the part. Change **Qty** if needed. The page shows the free stock.",
        "Press **Add outside work** for work done by someone else (for example tyre balancing at a supplier). Type the **Description** and **Price AED**.",
        "To give a discount on a line, type it in **Discount AED**. For the whole quotation, use **Overall discount (AED)**.",
        "Leave **Valid for (days)** empty to use the normal number of days.",
        "Press **Save quotation**. It gets a number, for example YAS-Q-26-00012-1.",
      ], tips: [
        "If the discount is above your limit, or a price is below the allowed level, the quotation shows **Needs manager approval**. It goes to the branch manager's Approvals before you can send it.",
        "Changing a saved quotation makes a new revision (-2, -3). Press **Save new revision**.",
      ] },
      { h: "Send it to the customer", steps: [
        "Press **Prepare approval message**. The WhatsApp text with the approval link is shown.",
        "Press **Open WhatsApp** and send it, or copy the text.",
        "Press **Mark as sent**. The quotation now shows as sent and waiting for the customer.",
        "The customer opens the link on their phone, sees each line with its price, and ticks what they approve. Their answer appears on the enquiry by itself.",
      ] },
      { h: "Record an answer given in person or by phone", steps: [
        "If the customer answers at the counter or on the phone, tick the lines they approve.",
        "Choose how they answered: **In person**, **Phone**, **WhatsApp reply** or **Email**.",
        "For phone or WhatsApp, type a note in the note box (for example \"Approved by phone, spoke to Mr Faisal 10:15\").",
        "Press **Record answer**.",
        "Lines the customer declines are kept as deferred work and offered again on the next visit.",
      ] },
      { h: "Create the job card", steps: [
        "Once at least one line is approved, press **Create job card**.",
        "The job card is made from the approved lines. Parts for those lines are set aside in stock.",
        "Continue with [Working with a job card](/help/job-card).",
      ] },
    ],
  },
  {
    slug: "job-card", group: "Front office", title: "Working with a job card",
    summary: "Follow a car through the workshop: status, extra work, deposits, delays and cancelling.", who: "Service advisor, foreman",
    access: ["jobs", "workshop"], open: { label: "Open Job cards", href: "/jobs" }, flows: ["customer-visit", "extra-work"],
    parts: [
      { h: "Find a job card", steps: [
        "Open **Front office, Job cards**. Late jobs are marked **Late**. Press the job number to open it.",
        "Or type the job number or plate in the search box at the top.",
      ] },
      { h: "What a job card shows", steps: [
        "The top shows the customer, vehicle, check-in (odometer, fuel, complaints), the promised time and the status.",
        "**Work approved** lists the approved lines with their technician and status.",
        "The workshop part has technicians, bays, clocked time, part requests, the quality check and delivery (see [Workshop board](/help/workshop-board) and [Quality check and delivery](/help/delivery)).",
        "**Customer messages**, **Status history** and **Approval history** are lower down.",
      ] },
      { h: "Job statuses", intro: "A job moves through these statuses:", steps: [
        "**Approved**: job card created, waiting to start.",
        "**Awaiting parts**: waiting for a part to arrive.",
        "**In progress**: a technician is working on it.",
        "**Quality check**: work finished, waiting for the foreman's check.",
        "**Ready**: passed the quality check. Set by the check, not by hand.",
        "**Delivered**: the car has been handed over with the delivery form.",
        "**Invoiced**, then **Closed** once it is invoiced, handed over and fully paid.",
        "**Cancelled**: stopped with a reason.",
      ] },
      { h: "Move the job or record a delay", steps: [
        "Use the status buttons under **Move job** to move it on, for example to **Awaiting parts**.",
        "If the job will miss the promised time, choose a **Delay reason (required)** and save. The customer can be told with **Prepare WhatsApp**.",
      ] },
      { h: "Extra work found during the job", steps: [
        "Add the extra labour or parts in the work panel on the job card.",
        "Save. It becomes a revised quotation for the customer.",
        "Send it with **Prepare approval message** and record the answer exactly as for the first quotation.",
        "Only approved extra lines are added to the job.",
      ] },
      { h: "Take a deposit", steps: [
        "Press **Take deposit** on the job card (see [Deposits](/help/advances)). The deposit is used automatically when the job is invoiced.",
      ] },
      { h: "Cancel a job", steps: [
        "Press **Cancel job**, type the **Reason for cancelling** and confirm. A job that has been invoiced cannot be cancelled.",
      ] },
    ],
  },
  {
    slug: "bookings", group: "Front office", title: "Booking calendar",
    summary: "Book a visit to a day, bay and technician, and see the workshop's load.", who: "Service advisor, branch manager",
    access: ["customers"], open: { label: "Open Booking calendar", href: "/bookings" },
    parts: [
      { h: "Book a visit", steps: [
        "Open the enquiry (or press **New enquiry to book** on the calendar, or **Book a visit** on the vehicle page).",
        "In the booking box choose the day and time, the **Bay**, the **Technician** and the **Hours** the work needs.",
        "As you choose the day, the page shows each bay's and technician's hours for that day with this booking added.",
        "If the day would be over capacity, the page shows **Over capacity**. Choose another time, or type a **Reason for overbooking** (for example \"fleet priority, short job\") if your branch allows it.",
        "Save. The booking shows on the calendar.",
      ] },
      { h: "Move or cancel a booking", steps: [
        "Open the booking on the enquiry. Press **Move booking** to change the time, or **Cancel booking** with a reason.",
        "If the customer did not turn up, press **Did not come**.",
      ] },
      { h: "Read the calendar", steps: [
        "Open **Front office, Booking calendar**. It shows today. Use **Next day ›**, **Today**, **Go to day** or the **Next seven days** strip to move.",
        "**Bay load** and **Technician load** show booked hours against each one's hours for the day. Red means overbooked.",
        "Below are the day's bookings and **Runs on this day** (pickups and recoveries).",
      ] },
    ],
  },
  {
    slug: "runs", group: "Front office", title: "Pickup, drop-off, recovery and towing",
    summary: "Schedule a driver to collect or return a car, or recover a breakdown.", who: "Service advisor, foreman",
    access: ["customers", "jobs", "workshop"], open: { label: "Open runs", href: "/workshop/runs" },
    parts: [
      { h: "Schedule a run", steps: [
        "Open the enquiry or job card and press **Schedule a run**. (For a run with no enquiry, use **Schedule a run not linked to an enquiry** on the runs page.)",
        "Choose the **Run type**: Pickup, Drop-off, Recovery or Towing.",
        "Choose the **Driver** from staff, or choose **Outside driver (type the name)** and type the name.",
        "Fill in **From** (for example the customer's address or breakdown spot), **To** (for example Workshop) and **When**.",
        "Add the **Recovery truck / vehicle**, the distance in km and the **Charge (AED)**. Type 0 if it is free.",
        "Press **Schedule run**. A charge is added to the quotation or job card as extra work for the customer to approve.",
      ] },
      { h: "Update a run", steps: [
        "On the run, press **Driver left** when the driver goes, and **Completed** when done. Press **Cancel** with a reason if it does not happen.",
        "The runs page filters by driver, type, status and dates.",
      ] },
    ],
  },
  {
    slug: "approvals", group: "Front office", title: "Approvals inbox (for approvers)",
    summary: "Approve, reject or send back discounts, orders, credit notes, leave and more.", who: "Branch manager, owner, line managers",
    access: ["approvals"], open: { label: "Open Approvals", href: "/approvals" }, flows: ["approvals"],
    parts: [
      { h: "Act on an approval", steps: [
        "The number beside **Approvals** in the menu shows how many wait for you.",
        "Open **Front office, Approvals**. **Waiting for me** lists each request with what it is, who sent it and the amount.",
        "Press the document to open it and check it.",
        "Press **Approve** to accept it.",
        "To refuse, type a **Comment** and press **Reject**. To ask for a change, type a comment and press **Send back**. The comment is required for both.",
        "Some requests need more than one approver. They move to the next approver after you.",
        "**Sent by me** lists your own requests and where they are.",
      ], tips: ["You can never approve something you sent yourself."] },
    ],
  },

  // ---------------- Workshop ----------------
  {
    slug: "workshop-board", group: "Workshop", title: "Workshop board, assigning work and the wall screen",
    summary: "See every car in the workshop, assign technicians and bays, and correct clock times.", who: "Foreman, branch manager",
    access: ["workshop"], open: { label: "Open Workshop board", href: "/workshop" }, flows: ["customer-visit"],
    parts: [
      { h: "Read the board", steps: [
        "Open **Workshop, Workshop board**. Each car is a tile showing the job, vehicle, technicians and status.",
        "Colours show time to the promised time: **On time**, **Due soon** and **Late**.",
        "The board refreshes by itself. Press a tile to open the job card.",
      ] },
      { h: "Assign technicians and a bay", steps: [
        "Open the job card. Under **Technicians**, each approved labour line is listed.",
        "Choose one or more technicians and the **Bay** for the line, then press **Assign**.",
        "The technicians now see the work in **My jobs** on their phones.",
      ] },
      { h: "Correct a clock time", steps: [
        "If a technician forgot to clock out, find the time under **Clocked / standard**.",
        "Type the **Corrected time** and a **Reason**, and press **Correct**. You cannot correct your own time.",
      ] },
      { h: "Answer part requests", steps: [
        "When a technician presses **Need part**, the request shows under **Part requests** on the job card and in the store queue.",
        "Parts that were not on the quotation must go to the customer first as extra work (see [Working with a job card](/help/job-card)).",
      ] },
      { h: "Show the board on a TV", steps: [
        "On the board press **Wall screen**, then **Copy** to copy the **Wall-screen link**.",
        "Open the link on the TV's browser. It does not need a sign-in and shows no prices or customer names.",
        "Press **Make a new link** to stop the old link working.",
      ] },
    ],
  },
  {
    slug: "my-jobs", group: "Workshop", title: "My jobs (for technicians, on the phone)",
    summary: "Clock in and out of your work, pause, switch jobs and ask for parts.", who: "Technician",
    access: ["technician"], open: { label: "Open My jobs", href: "/my-jobs" }, flows: ["customer-visit", "parts-for-job"],
    parts: [
      { h: "Start work", steps: [
        "Sign in on your phone and open **My jobs**. The work the foreman gave you is listed with the car and what to do.",
        "When you start a job, press **Clock in** on it.",
        "You can only be clocked in to one job at a time. If you press Clock in on another job, the page asks you to confirm. Press **Yes, switch to this job** to stop the first one and start the new one.",
      ] },
      { h: "Pause and resume", steps: [
        "For a break, or if you must wait, choose the **Pause reason** and press **Pause**.",
        "Press **Resume** when you start again.",
      ] },
      { h: "Ask for a part", steps: [
        "Press **Need part** on the job.",
        "Choose the part, or tick **Part not in the list** and describe it. Type the quantity.",
        "Save. The stock keeper sees it in the store queue. If the part was not quoted, the advisor asks the customer first.",
      ] },
      { h: "Finish", steps: [
        "When the work is done, press **Clock out (work finished)**.",
        "The job goes to the foreman's quality check.",
      ], tips: ["If you forgot to clock out, tell the foreman. They correct the time with a reason."] },
      { h: "If no work is shown", steps: [
        "**No work is assigned to you right now** means the foreman has not assigned you yet. Ask the foreman.",
      ] },
    ],
  },
  {
    slug: "delivery", group: "Workshop", title: "Quality check and delivering the car",
    summary: "Check the work, then hand the car over with the delivery form and signature.", who: "Foreman, service advisor",
    access: ["workshop", "jobs"], open: { label: "Open Job cards", href: "/jobs" }, flows: ["customer-visit"],
    parts: [
      { h: "Quality check (foreman)", steps: [
        "When technicians clock out, the job shows **Waiting for the supervisor's check**.",
        "Open the job card and go to **Quality check**. Test the car.",
        "If everything is right, choose **Done** (or **N/A** where a check does not apply) and press **Record check**. The job becomes **Ready**.",
        "If something is wrong, choose **Failed**, type **What failed**, and press **Record check**. The job goes back to the technician with your reason.",
      ] },
      { h: "Before the car can leave", steps: [
        "The delivery form only appears when nothing is owed, or the customer is on credit terms within their limit, or a manager has released the car.",
        "Normally, prepare the invoice and take the payment first (see [Invoicing a job](/help/invoicing) and [Taking a payment](/help/payments)).",
        "To let the car go unpaid, a branch manager types **Why the car may leave unpaid** and presses **Release on credit**. This is recorded under their name.",
      ] },
      { h: "Deliver the car", steps: [
        "On the job card go to **Delivery**.",
        "Walk the customer round the car and tick the walkthrough checklist.",
        "Choose what happened to the old parts: **Returned to the customer**, **Disposed** or **No old parts**.",
        "Type the **Odometer out (km)** and who received the car (**Received by**).",
        "Hand your phone or tablet to the customer to sign in the **Customer signature** box. Press **Clear** to start again.",
        "Press **Deliver the car**. The job becomes **Delivered**. It closes by itself once invoiced and fully paid.",
      ] },
    ],
  },

  // ---------------- Parts ----------------
  {
    slug: "stock", group: "Parts", title: "Stock on hand and receiving opening stock",
    summary: "See what you have, what is set aside for jobs, and add stock without a purchase order.", who: "Stock keeper",
    access: ["stock"], open: { label: "Open Stock on hand", href: "/stock" },
    parts: [
      { h: "Read the stock list", steps: [
        "Open **Parts, Stock on hand**. Type a part number or description and press **Filter**.",
        "**On hand** is what is on the shelf. **Reserved** is quoted and **Committed** is approved for a job. **Free** is what you can still sell or quote.",
        "Press a part to open its stock ledger: every movement in and out with the document.",
      ] },
      { h: "Add opening stock or a receipt with no purchase order", steps: [
        "On Stock on hand, find **Opening stock or a receipt without a purchase order**.",
        "Choose the **Part**, **Type** (**Opening stock** or **Receipt (before supplier bill)**), **Quantity** and **Unit cost (AED)**.",
        "Type a **Reference** (for example the GRN or delivery note) and press **Receive**.",
        "Normal deliveries should come through a purchase order (see [Purchase orders](/help/purchase-orders)).",
      ] },
    ],
  },
  {
    slug: "store-queue", group: "Parts", title: "Store queue: issuing parts to jobs",
    summary: "Give approved parts to technicians and answer their part requests.", who: "Stock keeper",
    access: ["stock"], open: { label: "Open Store queue", href: "/stock/queue" }, flows: ["parts-for-job"],
    parts: [
      { h: "Issue approved parts", steps: [
        "Open **Parts, Store queue**. **Approved parts not yet issued** lists parts the customer approved, by job.",
        "Take the part from the shelf, type the quantity and press **Issue**. The stock goes down and the part is charged to the job.",
        "You can issue part of the quantity now and the rest later.",
      ] },
      { h: "Answer a technician's request", steps: [
        "**Requests from technicians** lists **Need part** requests with who asked.",
        "If the part was approved, issue it and press **Mark handed out**.",
        "If the part was not quoted, it shows **Advisor to quote first**. The advisor asks the customer before you issue it.",
        "Press **Close** when a request is no longer needed.",
      ] },
      { h: "If the part is not in stock", steps: [
        "See [Planning and back orders](/help/planning) to order it or ask another branch.",
      ] },
    ],
  },
  {
    slug: "planning", group: "Parts", title: "Planning and back orders",
    summary: "Find parts jobs are waiting for and get them from a supplier or another branch.", who: "Stock keeper, purchasing officer",
    access: ["stock"], open: { label: "Open Planning", href: "/stock/planning" }, flows: ["parts-for-job"],
    parts: [
      { h: "See what jobs are waiting for", steps: [
        "Open **Parts, Planning and back orders**. Each row is a part a job needs: **Required**, **Committed**, **Back-ordered** and **Being sourced**.",
        "**Other branches (free)** shows how many other branches have free.",
      ] },
      { h: "Get the part", steps: [
        "To buy it, press **Raise PO**. A purchase order is started with the **Preferred supplier**, linked to the job.",
        "To take it from another branch, press **Request**. A transfer order is created (see [Transfer orders](/help/transfers)).",
        "Press **Set date** to record when the part is expected, so the advisor can tell the customer.",
      ] },
    ],
  },
  {
    slug: "transfers", group: "Parts", title: "Transfer orders between branches",
    summary: "Ask another branch for parts, approve, dispatch and receive.", who: "Stock keeper",
    access: ["stock"], open: { label: "Open Transfer orders", href: "/stock/transfers" }, flows: ["transfer"],
    parts: [
      { h: "Ask for parts (receiving branch)", steps: [
        "Open **Parts, Transfer orders**. Under **Ask another branch for parts**, choose the **From branch**.",
        "Add the parts and quantities and a **Note** saying why they are needed.",
        "Press **Send request**.",
      ] },
      { h: "Approve and dispatch (supplying branch)", steps: [
        "The supplying branch's manager approves the request in Approvals.",
        "The stock keeper there opens the transfer, packs the parts and presses **Dispatch**. The stock leaves their branch.",
      ] },
      { h: "Receive (receiving branch)", steps: [
        "When the parts arrive, open the transfer and type what arrived in **Received**.",
        "If less arrived, or a part is damaged, fill in **Short or damaged** and the **Reason if less arrived**.",
        "Press **Receive into stock**.",
        "A transfer can be cancelled before dispatch with **Cancel transfer** and a reason.",
      ] },
    ],
  },
  {
    slug: "counts", group: "Parts", title: "Stock adjustments and stock counts",
    summary: "Correct stock with an approved adjustment, and count the shelves blind.", who: "Stock keeper, branch manager",
    access: ["stock"], open: { label: "Open Adjustments and counts", href: "/stock/adjustments" },
    parts: [
      { h: "Make an adjustment", steps: [
        "Open **Parts, Adjustments and counts** and go to **New stock adjustment**.",
        "Choose the part, the quantity to add or take off, the **Reason** and a **Note** saying what happened.",
        "Press **Send for approval**. The stock changes only after the branch manager approves.",
      ] },
      { h: "Count the stock", steps: [
        "Under **Start a count sheet**, choose a **Category** or **All stock items** and start it.",
        "Open the count. It does not show the book quantity, so you count what is really there.",
        "Type the **Counted** quantity for each part and press **Save** as you go.",
        "When finished, press **Submit count**. The differences go for approval and then correct the stock.",
      ] },
    ],
  },
];

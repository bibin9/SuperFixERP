// Loads reference data, demo users and a few realistic jobs by calling the real services.
import fs from "node:fs";
import path from "node:path";
import { Client } from "pg";
import { dbConfig } from "../lib/env";
import { hashPassword } from "../lib/services/auth";
import { ctxFor } from "../lib/ctx-helper";
import { closePool } from "../lib/db";
import { receiveStock, issueToJobLine } from "../lib/services/stock";
import { createCustomer, createVehicle } from "../lib/services/customers";
import { addEnquiryLine, changeStatus } from "../lib/services/jobs";
import { createEnquiry, createJobCard } from "../lib/services/enquiries";
import { setAssignments, clock, recordQc } from "../lib/services/workshop";
import { saveQuotation, sendQuotation, recordDecisionsByStaff } from "../lib/services/quotations";
import { createEmployee, saveRecord } from "../lib/services/hr";
import { requestOvertime, requestLeave, adjustLeave } from "../lib/services/hr-time";
import { annualLeaveEarned } from "../lib/services/payroll-calc";
import { setOpeningSalary } from "../lib/services/payroll";
import { inbox, act } from "../lib/services/workflow";
import { createBill } from "../lib/services/purchasing";

export const DEMO_PASSWORD = "Superfix@2026";

export const USERS: [string, string, string | null, string, string][] = [
  // username, full name, branch code (null = all branches), role, default branch
  ["admin", "System Admin", null, "admin", "HQ"],
  ["saeed", "Saeed Al Mazrouei", null, "owner", "HQ"],
  ["yousef", "Yousef Kareem", "YAS", "branch_manager", "YAS"],
  ["priya", "Priya Menon", "YAS", "advisor", "YAS"],
  ["khalid", "Khalid Rahman", "YAS", "foreman", "YAS"],
  ["ramesh", "Ramesh K.", "YAS", "technician", "YAS"],
  ["arjun", "Arjun P.", "YAS", "technician", "YAS"],
  ["anil", "Anil Kumar", "YAS", "stock_keeper", "YAS"],
  ["maryam", "Maryam Haddad", null, "accountant", "HQ"],
  ["fatima.hr", "Fatima Saleh", null, "hr_payroll", "HQ"],
  ["omar", "Omar Farouk", "QUS", "branch_manager", "QUS"],
  ["sara", "Sara Ali", "QUS", "advisor", "QUS"],
];

export async function seed(adminUrl: string, opts: { demoJobs?: boolean; history?: boolean } = { demoJobs: true }) {
  const c = new Client({ connectionString: adminUrl });
  await c.connect();
  try {
    if ((await c.query("SELECT count(*) n FROM branch")).rows[0].n !== "0") throw new Error("Database already has data. Run npm run db:reset to start again.");
    await c.query("BEGIN");
    await c.query(fs.readFileSync(path.join(process.cwd(), "scripts", "seed-data.sql"), "utf8"));
    const pw = hashPassword(DEMO_PASSWORD);
    for (const [u, name, br, role, def] of USERS) {
      const r = await c.query("INSERT INTO app_user (username, full_name, password_hash, default_branch_id) VALUES ($1,$2,$3,(SELECT id FROM branch WHERE code = $4)) RETURNING id", [u, name, pw, def]);
      await c.query("INSERT INTO user_branch_role (user_id, branch_id, role_id) VALUES ($1,(SELECT id FROM branch WHERE code = $2),(SELECT id FROM role WHERE code = $3))", [r.rows[0].id, br, role]);
    }
    // Priya also works at Yas South (one role per branch, BR-07 branch switcher).
    await c.query("INSERT INTO user_branch_role (user_id, branch_id, role_id) SELECT u.id, b.id, r.id FROM app_user u, branch b, role r WHERE u.username = 'priya' AND b.code = 'YSS' AND r.code = 'advisor'");
    // The owner's own voucher goes to the accountant (a user never approves their own document).
    // The foreman supervises, so only part of his day is bookable (Technician capacity master).
    await c.query("INSERT INTO technician_capacity (user_id, daily_hours, note) SELECT id, 4, 'Foreman: supervises, so only part of the day is bookable' FROM app_user WHERE username = 'khalid'");
    await c.query("UPDATE workflow_step s SET backup_user_id = (SELECT id FROM app_user WHERE username = 'maryam') FROM workflow w WHERE w.id = s.workflow_id AND w.doc_type = 'voucher'");
    await c.query("COMMIT");
  } catch (e) {
    await c.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    await c.end();
  }
  if (opts.demoJobs === false) return;

  // Opening stock through the stock engine (weighted average cost, journals).
  const anil = await ctxFor("anil", "YAS");
  const items = await itemIds(adminUrl);
  const stock: [string, string, string][] = [
    ["OIL-5W30-L", "200", "8.00"], ["FLT-OIL-90915", "30", "18.50"], ["BRK-PAD-FR-LC", "2", "210.00"], ["FLT-AIR-17801", "12", "38.00"],
    ["TYR-2656517", "16", "285.00"], ["BAT-70AH", "6", "260.00"], ["WPR-24", "20", "21.00"], ["CLT-L", "40", "9.50"],
  ];
  for (const [p, q, cost] of stock) await receiveStock(anil, { item_id: items[p], qty: q, unit_cost: cost, kind: "opening", ref: "Opening stock" });
  const omar = await ctxFor("omar", "QUS");
  for (const [p, q, cost] of stock.slice(0, 5)) await receiveStock(omar, { item_id: items[p], qty: q, unit_cost: cost, kind: "opening", ref: "Opening stock" });

  // Customers and vehicles (shared by all branches).
  const priya = await ctxFor("priya", "YAS");
  const faisal = (await createCustomer(priya, { customer_type: "individual", title: "Mr", first_name: "Faisal", last_name: "Al Qahtani", country_code: "SA", mobile: "0558321109", email: "faisal@example.com", id_type: "National ID", id_number: "1087345521", marketing_consent: "on" })).id!;
  const fatima = (await createCustomer(priya, { customer_type: "individual", title: "Mrs", first_name: "Fatima", last_name: "Al Zaabi", country_code: "AE", mobile: "050 441 2290", id_type: "Emirates ID", id_number: "784198844712036" })).id!;
  const fleet = (await createCustomer(priya, { customer_type: "corporate", company_name: "Emirates Fleet Services LLC", country_code: "AE", mobile: "+971 2 555 0101", trn: "100234567800003", price_level: "fleet", peppol_id: "0235:100234567800003", trade_licence_no: "CN-1104578", licence_authority: "ad_ded",
    building_street: "Musaffah M-14, Plot 22", city: "Abu Dhabi", emirate: "abu_dhabi", po_box: "41234", contact_person: "Rashed Al Ali (fleet manager)", contact_phone: "+97125550100", credit_limit: "50000", payment_terms_days: "30", fleet_discount_pct: "5", lpo_required: "on" })).id!;
  const lc = (await createVehicle(priya, { owner_customer_id: faisal, registered_in: "AUH", plate_code: "5", plate_number: "48213", vin: "JTMHV05J904123456", make: "Toyota", model: "Land Cruiser", model_year: "2021", colour: "White", odometer: "58200" })).id!;
  const patrol = (await createVehicle(priya, { owner_customer_id: fatima, registered_in: "AUH", plate_code: "1", plate_number: "77120", vin: "JN8AY2NY5L9012345", make: "Nissan", model: "Patrol", model_year: "2020", colour: "Silver", odometer: "91000" })).id!;
  const hilux = (await createVehicle(priya, { owner_customer_id: fleet, registered_in: "DXB", plate_code: "K", plate_number: "33105", vin: "MR0HA3CD100123456", make: "Toyota", model: "Hilux", model_year: "2022", colour: "White", odometer: "64000" })).id!;

  const svc = await serviceIds(adminUrl);

  // Every job follows the FSD v0.10 flow: enquiry, quotation, customer approval, then the job card.
  const soon = (h: number) => new Date(Date.now() + h * 3600_000).toISOString();

  // Enquiry 1 (YAS): 60,000 km service, quotation sent and waiting for the customer (FSD 5.1 example, 978.08).
  const e1 = await createEnquiry(priya, { follow_up_at: "2026-12-01T10:00", customer_id: faisal, vehicle_id: lc, service_asked: "60,000 km service and brake noise", source: "whatsapp",
    odometer_in: "60110", fuel_level: "5", complaints: "60k service due; squeal from front brakes" });
  await addEnquiryLine(priya, e1.id, { line_type: "labour", service_id: svc["SVC-60K"] });
  await addEnquiryLine(priya, e1.id, { line_type: "part", item_id: items["OIL-5W30-L"], qty: "5" });
  await addEnquiryLine(priya, e1.id, { line_type: "part", item_id: items["FLT-OIL-90915"], qty: "1" });
  await addEnquiryLine(priya, e1.id, { line_type: "part", item_id: items["BRK-PAD-FR-LC"], qty: "1" });
  const q1 = await saveQuotation(priya, e1.id, { doc_discount: "103.50" });
  if (q1.status === "ready_to_send") await sendQuotation(priya, q1.id);

  // Enquiry 2 (YAS): approved in person (wiper declined), job card created, parts issued, ready to invoice.
  const e2 = await createEnquiry(priya, { follow_up_at: "2026-12-01T10:00", customer_id: fatima, vehicle_id: patrol, service_asked: "AC not cooling, oil change", source: "walk_in",
    odometer_in: "91240", fuel_level: "3", complaints: "A/C not cooling; Oil change due" });
  await addEnquiryLine(priya, e2.id, { line_type: "labour", service_id: svc["AC-REGAS"] });
  await addEnquiryLine(priya, e2.id, { line_type: "labour", service_id: svc["OIL-QK"] });
  await addEnquiryLine(priya, e2.id, { line_type: "part", item_id: items["OIL-5W30-L"], qty: "6" });
  await addEnquiryLine(priya, e2.id, { line_type: "part", item_id: items["WPR-24"], qty: "2" });
  const q2 = await saveQuotation(priya, e2.id, {});
  await sendQuotation(priya, q2.id);
  const ql2 = await ctxLines(adminUrl, q2.id);
  await recordDecisionsByStaff(priya, q2.id, Object.fromEntries(ql2.map((l) => [l.id, l.description.startsWith("WPR") ? "declined" : "approved"])), "in_person", null);
  const j2 = await createJobCard(priya, e2.id, { job_type: "service", promised_at: soon(3) });
  for (const l of await partLines(adminUrl, j2.id)) await issueToJobLine(anil, l.id, l.qty);
  // Workshop floor: the foreman assigns Ramesh, who clocks the work; the foreman passes the quality check.
  const khalid = await ctxFor("khalid", "YAS");
  const ramesh = await ctxFor("ramesh", "YAS");
  const rameshId = (await q(adminUrl, "SELECT id FROM app_user WHERE username = 'ramesh'"))[0].id;
  for (const l of await q(adminUrl, "SELECT id FROM job_line WHERE job_card_id = $1 AND line_type = 'labour' AND approval_status = 'approved'", [j2.id])) {
    await setAssignments(khalid, l.id, [rameshId]);
    await clock(ramesh, l.id, "clock_in", { confirmSwitch: true });
    await clock(ramesh, l.id, "clock_out");
  }
  await changeStatus(priya, j2.id, "quality_check");
  const qcAll = Object.fromEntries((await q(adminUrl, "SELECT code FROM lookup_value WHERE list = 'qc_checklist'")).map((r) => [r.code, "done"]));
  await recordQc(khalid, j2.id, qcAll, {});

  // Enquiry 4 (YAS): AC and battery approved; on the workshop floor now. Ramesh and Arjun share the AC work and
  // Arjun is clocked in on the battery, so the board and the technician phone screen have live work to show.
  const noura = (await createCustomer(priya, { customer_type: "individual", title: "Ms", first_name: "Noura", last_name: "Al Hammadi", country_code: "AE", mobile: "052 610 7741", id_type: "Emirates ID", id_number: "784199012345671" })).id!;
  const prado = (await createVehicle(priya, { owner_customer_id: noura, registered_in: "AUH", plate_code: "2", plate_number: "60417", vin: "JTEBH3FJ70K123456", make: "Toyota", model: "Prado", model_year: "2019", colour: "Black", odometer: "120300" })).id!;
  const e4 = await createEnquiry(priya, { follow_up_at: "2026-12-01T10:00", customer_id: noura, vehicle_id: prado, service_asked: "AC weak, battery weak", source: "walk_in", odometer_in: "120410", fuel_level: "4", complaints: "AC not cold at noon; slow to start in the morning" });
  await addEnquiryLine(priya, e4.id, { line_type: "labour", service_id: svc["AC-REGAS"] });
  await addEnquiryLine(priya, e4.id, { line_type: "labour", service_id: svc["BATT-FIT"] });
  await addEnquiryLine(priya, e4.id, { line_type: "part", item_id: items["BAT-70AH"], qty: "1" });
  const q4 = await saveQuotation(priya, e4.id, {});
  if (q4.status === "ready_to_send") await sendQuotation(priya, q4.id);
  const ql4 = await ctxLines(adminUrl, q4.id);
  await recordDecisionsByStaff(priya, q4.id, Object.fromEntries(ql4.map((l) => [l.id, "approved"])), "in_person", null);
  const j4 = await createJobCard(priya, e4.id, { job_type: "repair", promised_at: soon(5) });
  const arjunId = (await q(adminUrl, "SELECT id FROM app_user WHERE username = 'arjun'"))[0].id;
  const bay = (await q(adminUrl, "SELECT id FROM bay WHERE branch_id = (SELECT id FROM branch WHERE code = 'YAS') AND active ORDER BY code LIMIT 1"))[0]?.id ?? null;
  const l4 = await q(adminUrl, "SELECT id, description FROM job_line WHERE job_card_id = $1 AND line_type = 'labour' ORDER BY line_no", [j4.id]);
  await setAssignments(khalid, l4[0].id, [rameshId, arjunId], bay);
  if (l4[1]) await setAssignments(khalid, l4[1].id, [arjunId], bay);
  if (l4[1]) await clock(await ctxFor("arjun", "YAS"), l4[1].id, "clock_in");
  // Spread the clock times over the morning so Technician time shows a real day (with a tea break and a wait for parts).
  const rl = await q(adminUrl, "SELECT DISTINCT job_line_id FROM time_event WHERE technician_id = $1 ORDER BY job_line_id", [rameshId]);
  const shift = async (line: string, tech: string, kind: string, minsAgo: number) =>
    q(adminUrl, "UPDATE time_event SET at = now() - make_interval(mins => $4) WHERE job_line_id = $1 AND technician_id = $2 AND kind = $3", [line, tech, kind, minsAgo]);
  const addEv = async (line: string, tech: string, kind: string, minsAgo: number, reason: string | null) =>
    q(adminUrl, `INSERT INTO time_event (branch_id, job_card_id, job_line_id, technician_id, kind, reason, at, device)
      SELECT j.branch_id, j.id, l.id, $2, $3, $4, now() - make_interval(mins => $5), 'seed' FROM job_line l JOIN job_card j ON j.id = l.job_card_id WHERE l.id = $1`, [line, tech, kind, reason, minsAgo]);
  if (rl[0]) {
    await shift(rl[0].job_line_id, rameshId, "clock_in", 230); await shift(rl[0].job_line_id, rameshId, "clock_out", 150);
    await addEv(rl[0].job_line_id, rameshId, "pause", 195, "break"); await addEv(rl[0].job_line_id, rameshId, "resume", 180, null);
  }
  if (rl[1]) {
    await shift(rl[1].job_line_id, rameshId, "clock_in", 145); await shift(rl[1].job_line_id, rameshId, "clock_out", 70);
    await addEv(rl[1].job_line_id, rameshId, "pause", 120, "parts"); await addEv(rl[1].job_line_id, rameshId, "resume", 105, null);
  }
  if (l4[1]) await shift(l4[1].id, arjunId, "clock_in", 55);

  // Enquiry 3 (QUS, Al Qusais): fleet 10k service quoted at another branch, used to show branch separation.
  const sara = await ctxFor("sara", "QUS");
  const e3 = await createEnquiry(sara, { follow_up_at: "2026-12-01T10:00", customer_id: fleet, vehicle_id: hilux, service_asked: "Fleet 10k service", source: "phone", odometer_in: "64500", fuel_level: "4" });
  await addEnquiryLine(sara, e3.id, { line_type: "labour", service_id: svc["SVC-10K"] });
  await addEnquiryLine(sara, e3.id, { line_type: "part", item_id: items["OIL-5W30-L"], qty: "6" });
  await saveQuotation(sara, e3.id, {});
  await seedHr(adminUrl);
  if (opts.history) { await seedServiceHistory(adminUrl); await seedDemoBill(adminUrl); }
}

/** One posted supplier bill (workshop cleaning supplies, no stock) so the purchase report has data in the demo. */
async function seedDemoBill(adminUrl: string) {
  const sup = (await q(adminUrl, "SELECT id FROM supplier WHERE code = 'AFLUB'"))[0];
  if (!sup) return;
  const day = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Dubai" });
  await createBill(await ctxFor("maryam", "YAS"), { supplier_id: sup.id, supplier_invoice_no: "AFL-DEMO-0001", invoice_date: day,
    lines: [{ description: "Workshop degreaser and shop towels", expense_type: "cleaning", qty: "1", unit_price: "420" }] });
}

/** Phase 5 demo staff: employee files linked to the demo users, salaries, documents near expiry, overtime and leave. */
async function seedHr(adminUrl: string) {
  const one = async (sql: string, p: unknown[] = []) => (await q(adminUrl, sql, p))[0];
  const id = async (table: string, where: string, p: unknown[]) => (await one(`SELECT id FROM ${table} WHERE ${where}`, p)).id as string;
  const br = async (code: string) => id("branch", "code = $1", [code]);
  const dep = async (code: string) => id("department", "code = $1", [code]);
  const des = async (code: string) => id("designation", "code = $1", [code]);
  const user = async (u: string) => id("app_user", "username = $1", [u]);
  const enbd = await id("wps_agent", "code = $1", ["ENBD"]), ansari = await id("wps_agent", "code = $1", ["ALANSARI"]);
  const day = await id("shift", "code = $1", ["DAY"]), office = await id("shift", "code = $1", ["OFFICE"]);
  const fatima = await ctxFor("fatima.hr", "HQ");
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Dubai" });
  const plus = (n: number) => { const d = new Date(`${today}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  // [username, first, last, nationality, branch, dept, designation, joining, line manager username, pay [basic, housing, transport], wps agent, pay method, shift]
  const staff: [string | null, string, string, string, string, string, string, string, string | null, [number, number, number], string, "iban" | "wps_card", string][] = [
    ["yousef", "Yousef", "Kareem", "JO", "YAS", "MGMT", "BM", "2019-03-01", null, [9000, 4000, 1500], enbd, "iban", office],
    ["khalid", "Khalid", "Rahman", "PK", "YAS", "WORKSHOP", "FOREMAN", "2017-09-01", "yousef", [5000, 2500, 800], enbd, "iban", day],
    ["priya", "Priya", "Menon", "IN", "YAS", "FRONT", "ADVISOR", "2021-06-15", "yousef", [4500, 2000, 800], enbd, "iban", office],
    ["ramesh", "Ramesh", "Kumar", "IN", "YAS", "WORKSHOP", "SR-TECH", "2020-01-10", "khalid", [2000, 1000, 300], ansari, "wps_card", day],
    ["arjun", "Arjun", "Pillai", "IN", "YAS", "WORKSHOP", "TECH", "2026-06-01", "khalid", [1800, 900, 300], ansari, "wps_card", day],
    ["anil", "Anil", "Kumar", "IN", "YAS", "PARTS", "STORE", "2022-02-01", "yousef", [2800, 1200, 500], enbd, "iban", day],
    [null, "Rashid", "Khan", "PK", "YAS", "WORKSHOP", "DRIVER", "2024-04-01", "khalid", [1500, 800, 0], ansari, "wps_card", day],
    ["omar", "Omar", "Farouk", "EG", "QUS", "MGMT", "BM", "2018-05-01", null, [9000, 4000, 1500], enbd, "iban", office],
    ["sara", "Sara", "Ali", "EG", "QUS", "FRONT", "ADVISOR", "2023-03-01", "omar", [4000, 1800, 600], enbd, "iban", office],
    ["maryam", "Maryam", "Haddad", "JO", "HQ", "FIN", "ACCT", "2019-11-01", null, [8000, 3500, 1000], enbd, "iban", office],
    ["fatima.hr", "Fatima", "Nasser", "AE", "HQ", "HR", "HR-OFF", "2020-08-01", null, [6500, 3000, 1000], enbd, "iban", office],
  ];
  const empIds: Record<string, string> = {};
  let n = 0;
  for (const [u, fn, ln, nat, b, dp, dg, join, lm, pay, agent, method, shift] of staff) {
    n++;
    const key = u ?? `${fn}.${ln}`.toLowerCase();
    // Probation ends 13 days from today for a recent joiner, but never more than six months after joining (UAE Labour Law).
    const sixMonths = (() => { const d = new Date(`${join}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 180); return d.toISOString().slice(0, 10); })();
    const probation = join > plus(-180) ? (plus(13) < sixMonths ? plus(13) : sixMonths) : null;
    const e = await createEmployee(fatima, {
      branch_id: await br(b), first_name: fn, last_name: ln, nationality: nat, date_of_birth: `19${80 + (n % 15)}-0${1 + (n % 9)}-1${n % 9}`, gender: ["priya", "sara", "maryam", "fatima.hr"].includes(u ?? "") ? "female" : "male",
      department_id: await dep(dp), designation_id: await des(dg), joining_date: join, contract_type: "unlimited", probation_end: probation,
      line_manager_id: lm ? empIds[lm] : "", mohre_person_code: String(10000000000000 + n * 7919), labour_card_no: `LC${100200 + n}`,
      wps_agent_id: agent, pay_method: method, iban: method === "iban" ? `AE07033123456789012${String(n).padStart(4, "0")}` : "", wps_card_no: method === "wps_card" ? `4012000011${String(n).padStart(6, "0")}` : "",
      shift_id: shift, weekly_off: "5", user_id: u ? await user(u) : "", mobile: `+97150${String(1000000 + n * 1371).slice(0, 7)}`,
    });
    empIds[key] = e.id;
    await setOpeningSalary(fatima, e.id, { basic: String(pay[0]), housing: String(pay[1]), transport: pay[2] ? String(pay[2]) : "" }, join);
  }
  // Opening annual leave balances carried over from before go-live (otherwise long-serving staff would show years of untaken leave).
  const opening: Record<string, number> = { yousef: 24, khalid: 18, priya: 21, ramesh: 30, anil: 12, "rashid.khan": 15, omar: 20, sara: 14, maryam: 22, "fatima.hr": 16 };
  for (const [k, target] of Object.entries(opening)) {
    const join = (await one("SELECT to_char(joining_date,'YYYY-MM-DD') j FROM employee WHERE id = $1", [empIds[k]])).j as string;
    const adj = (target - Number(annualLeaveEarned(join, today))).toFixed(2);
    if (Number(adj) !== 0) await adjustLeave(fatima, { employee_id: empIds[k], leave_type: "annual", days: adj, reason: "Opening balance at go-live (leave taken before, from the old records)", adj_date: `${today.slice(0, 4)}-01-01` });
  }
  // The checklist for the long-serving staff is done; Arjun's is still open (joined this year).
  await q(adminUrl, "UPDATE employee_checklist SET done = true, done_at = now() WHERE employee_id <> $1", [empIds.arjun]);
  // Documents, insurance and air tickets: Ramesh's passport expires in 25 days, Arjun's visa in 50 (alerts).
  await saveRecord(fatima, empIds.ramesh, "document", { doc_type: "passport", number: "N4471223", issue_date: "2016-12-10", expiry_date: plus(25) });
  await saveRecord(fatima, empIds.ramesh, "document", { doc_type: "visa", number: "201/2024/7712345", issue_date: "2024-01-05", expiry_date: "2027-01-04" });
  await saveRecord(fatima, empIds.arjun, "document", { doc_type: "visa", number: "201/2026/5512091", issue_date: "2026-05-20", expiry_date: plus(50) });
  await saveRecord(fatima, empIds.priya, "document", { doc_type: "passport", number: "Z5512876", issue_date: "2019-03-01", expiry_date: "2029-02-28" });
  await saveRecord(fatima, empIds.ramesh, "insurance", { provider: "Daman", policy_no: "DM-77-1203", card_no: "784-1203-88", category: "basic", start_date: "2026-01-01", expiry_date: "2026-12-31", premium: "750" });
  await saveRecord(fatima, empIds.khalid, "air_ticket", { cycle_years: "2", sector: "Abu Dhabi - Lahore", ticket_amount: "2400", last_used: "2025-07-15" });
  await saveRecord(fatima, empIds.ramesh, "air_ticket", { cycle_years: "1", sector: "Abu Dhabi - Kochi", ticket_amount: "1500", last_used: "2025-12-20" });
  await saveRecord(fatima, empIds.ramesh, "asset", { asset_name: "toolbox", serial: "TB-0145", issue_date: "2020-01-12", condition: "New" });
  // Last month: Ramesh worked 10 hours of overtime (approved by Khalid), Priya took 3 days' annual leave.
  const lastMonth = (() => { const d = new Date(`${today.slice(0, 7)}-01T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() - 1); return d.toISOString().slice(0, 7); })();
  await requestOvertime(fatima, { employee_id: empIds.ramesh, work_date: `${lastMonth}-14`, hours: "4", ot_type: "normal", reason: "Fleet backlog" });
  await requestOvertime(fatima, { employee_id: empIds.ramesh, work_date: `${lastMonth}-21`, hours: "6", ot_type: "rest_day", reason: "Rest-day recovery job" });
  await requestLeave(await ctxFor("priya", "YAS"), { leave_type: "annual", from_date: `${lastMonth}-06`, to_date: `${lastMonth}-08`, reason: "Family visit" });
  for (const [u, b] of [["khalid", "YAS"], ["yousef", "YAS"], ["fatima.hr", "HQ"]] as const) {
    const ctx = await ctxFor(u, b);
    for (const t of await inbox(ctx)) if (["overtime_request", "leave_request"].includes(t.doc_type)) await act(ctx, t.task_id, "approved");
  }
  // This month: Ramesh asks for two days' sick leave next week (waiting for Khalid).
  await requestLeave(await ctxFor("ramesh", "YAS"), { leave_type: "sick", from_date: plus(7), to_date: plus(8), reason: "Medical appointment" });
  // Punching machines: Yas has synced this morning, Al Qusais has been offline for three hours. Two days ago
  // Arjun punched in but not out (a missing punch for the manager to fix). Khalid's visa expires in 3 weeks.
  for (const [k, inT, outT] of [["khalid", "07:52", "17:06"], ["arjun", "08:11", "17:15"], ["yousef", "08:40", "18:10"]] as const) {
    for (const back of [1, 2]) {
      const dd = plus(-back);
      if (!(k === "arjun" && back === 2)) await q(adminUrl, "INSERT INTO punch (branch_id, employee_id, at, source, device_ref) SELECT branch_id, id, ($2::timestamp AT TIME ZONE 'Asia/Dubai'), 'device', 'YAS-ZK1' FROM employee WHERE id = $1 ON CONFLICT DO NOTHING", [empIds[k], `${dd} ${outT}`]);
      await q(adminUrl, "INSERT INTO punch (branch_id, employee_id, at, source, device_ref) SELECT branch_id, id, ($2::timestamp AT TIME ZONE 'Asia/Dubai'), 'device', 'YAS-ZK1' FROM employee WHERE id = $1 ON CONFLICT DO NOTHING", [empIds[k], `${dd} ${inT}`]);
    }
  }
  // After-hours key drop: a customer dropped the key last night (waiting for the advisor's check-in).
  await q(adminUrl, `INSERT INTO key_drop (branch_id, doc_no, title, name, mobile, registered_in, plate_code, plate_number, make_model, odometer, service_asked, complaints, valuables, key_slot, signature, agreed_at, created_at)
    SELECT id, 'KD-YAS-0001', 'Mr', 'Hamad Al Ketbi', '+971501112201', 'AUH', '7', '11021', 'Nissan Altima', 84210, 'Brakes', 'Grinding noise from the front when braking', 'None', '7',
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', now() - interval '10 hours', now() - interval '10 hours' FROM branch WHERE code = 'YAS'`);
  await q(adminUrl, "INSERT INTO punch_device (branch_id, code, name, model) SELECT id, code || '-ZK1', name_en || ' entrance', 'ZKTeco K40' FROM branch WHERE code IN ('YAS','QUS','HQ') ON CONFLICT (code) DO NOTHING");
  await q(adminUrl, "UPDATE punch_device SET last_sync_at = now() - interval '4 minutes', last_sync_count = 3 WHERE code = 'YAS-ZK1'");
  await q(adminUrl, "UPDATE punch_device SET last_sync_at = now() - interval '9 minutes', last_sync_count = 2 WHERE code = 'HQ-ZK1'");
  await q(adminUrl, "UPDATE punch_device SET last_sync_at = now() - interval '3 hours', last_sync_count = 12 WHERE code = 'QUS-ZK1'");
  await q(adminUrl, `INSERT INTO employee_record (branch_id, employee_id, kind, data, expiry_date) SELECT branch_id, id, 'document', jsonb_build_object('doc_type', 'visa', 'number', '201/2024/7781234', 'expiry_date', $2::text), $2::date FROM employee WHERE id = $1`, [empIds.khalid, plus(21)]);
}

/**
 * Reports demo (phase 6): service history imported from Tally for eight more vehicles, so the next-service
 * report (TR-01) and the archive have data. These are closed job cards with old dates; they carry no
 * invoices or journals, so no balance changes. Dates are relative to today so the demo stays current.
 */
async function seedServiceHistory(adminUrl: string) {
  const c = new Client({ connectionString: adminUrl });
  await c.connect();
  try {
    await c.query("BEGIN");
    await c.query("SET LOCAL session_replication_role = replica"); // imported history: skip the quote-first rule for these closed jobs
    const H: [string, string, string, string, string, string, string, number, string, number, number][] = [
      // branch, first, last, mobile, plate code, plate, make model, year, last service (SQL date), km at last service, km now
      ["YAS", "Hamad", "Al Ketbi", "+971501112201", "7", "11021", "Nissan|Altima", 2019, "current_date - interval '20 months'", 70100, 84000],
      ["YAS", "Mariam", "Al Suwaidi", "+971501112202", "12", "11022", "Toyota|Camry", 2020, "current_date - interval '17 months'", 52000, 61500],
      ["YAS", "Rajesh", "Pillai", "+971501112203", "4", "11023", "Honda|Accord", 2018, "current_date - interval '14 months'", 98000, 109000],
      ["YAS", "Ahmed", "Al Nuaimi", "+971501112204", "9", "11024", "Lexus|LX570", 2021, "(current_date - interval '6 months')::date + 8", 41000, 47500],
      ["YAS", "Sophie", "Martin", "+971501112205", "3", "11025", "Mitsubishi|Pajero", 2017, "(current_date - interval '6 months')::date + 23", 120500, 126000],
      ["YAS", "Omar", "Haddad", "+971501112206", "6", "11026", "Kia|Sorento", 2022, "current_date - interval '3 months'", 30000, 34000],
      ["YAS", "Li", "Wei", "+971501112207", "15", "11027", "Hyundai|Tucson", 2021, "current_date - interval '4 months'", 45000, 56200],
      ["QUS", "Khaled", "Mansour", "+971501112208", "A", "11028", "Ford|Explorer", 2020, "(current_date - interval '6 months')::date + 12", 66000, 72000],
    ];
    let n = 0;
    for (const [br, first, last, mobile, pc, plate, mm, year, when, km, kmNow] of H) {
      n++;
      const [make, model] = mm.split("|");
      const b = (await c.query("SELECT id FROM branch WHERE code = $1", [br])).rows[0].id;
      const adv = (await c.query("SELECT id FROM app_user WHERE username = $1", [br === "YAS" ? "priya" : "sara"])).rows[0].id;
      const cust = (await c.query("INSERT INTO customer (customer_no, customer_type, title, first_name, last_name, country_code, mobile, whatsapp, preferred_branch_id, created_by, id_type, id_number) VALUES ($1,'individual',$7,$2,$3,'AE',$4,true,$5,$6,'Emirates ID',$8) RETURNING id",
        [`H${1000 + n}`, first, last, mobile, b, adv, ['Mariam', 'Sophie'].includes(first) ? 'Ms' : 'Mr', `784-19${70 + (n % 30)}-${String(1234567 + n * 7919).slice(0, 7)}-${n % 10}`])).rows[0].id;
      const veh = (await c.query("INSERT INTO vehicle (registered_in, plate_code, plate_number, make, model, model_year, odometer, owner_customer_id, vin_missing_reason, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'Imported from Tally without VIN',$9) RETURNING id",
        [br === "YAS" ? "AUH" : "DXB", pc, plate, make, model, year, kmNow, cust, adv])).rows[0].id;
      await c.query("INSERT INTO vehicle_customer (vehicle_id, customer_id, relation) VALUES ($1,$2,'owner')", [veh, cust]);
      const jobs = n === 1 ? [`${when} - interval '6 months'`, when] : [when];
      for (const [i, d] of jobs.entries()) {
        await c.query(`INSERT INTO job_card (branch_id, doc_no, doc_date, job_type, customer_id, vehicle_id, odometer_in, complaints, advisor_id, promised_at, ready_at, delivered_at, status, created_at, created_by)
          VALUES ($1, $2, (${d})::date, 'service', $3, $4, $5, 'Periodic service due (history imported from Tally)', $6, (${d})::date + time '17:00', (${d})::date + time '15:30', (${d})::date + time '18:00', 'closed', (${d})::date + time '08:30', $6)`,
          [b, `${br}-HIST-${String(n).padStart(2, "0")}${i ? "B" : ""}`, cust, veh, i === jobs.length - 1 ? km : km - 9000, adv]);
      }
    }
    await c.query("COMMIT");
  } catch (e) {
    await c.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    await c.end();
  }
}

async function q(adminUrl: string, sql: string, params: unknown[] = []) {
  const c = new Client({ connectionString: adminUrl });
  await c.connect();
  try { return (await c.query(sql, params)).rows; } finally { await c.end(); }
}
const itemIds = async (u: string) => Object.fromEntries((await q(u, "SELECT part_no, id FROM item")).map((r) => [r.part_no, r.id]));
const serviceIds = async (u: string) => Object.fromEntries((await q(u, "SELECT code, id FROM service")).map((r) => [r.code, r.id]));
const ctxLines = async (u: string, qid: string) => q(u, "SELECT id, description FROM quotation_line WHERE quotation_id = $1", [qid]);
const partLines = async (u: string, jobId: string) => q(u, "SELECT id, qty FROM job_line WHERE job_card_id = $1 AND line_type = 'part' AND approval_status = 'approved'", [jobId]);

/** --if-empty: used on hosted deploys; seeds only a brand-new database and leaves existing data alone. */
async function hasData(adminUrl: string) {
  const c = new Client({ connectionString: adminUrl });
  await c.connect();
  try { return (await c.query("SELECT count(*) n FROM branch")).rows[0].n !== "0"; } finally { await c.end(); }
}

if (require.main === module) {
  (async () => {
    if (process.argv.includes("--if-empty") && await hasData(dbConfig().adminUrl)) { console.log("database already has data; demo seed skipped"); return "skip"; }
    return seed(dbConfig().adminUrl, { demoJobs: true, history: true });
  })()
    .then(async (r) => { await closePool(); if (r !== "skip") console.log(`seeded. Sign in as any demo user with password ${DEMO_PASSWORD}`); })
    .catch(async (e) => { await closePool(); console.error(e); process.exit(1); });
}

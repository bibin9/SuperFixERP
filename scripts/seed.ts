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
import { saveQuotation, sendQuotation, recordDecisionsByStaff } from "../lib/services/quotations";

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

export async function seed(adminUrl: string, opts: { demoJobs?: boolean } = { demoJobs: true }) {
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
  const fleet = (await createCustomer(priya, { customer_type: "corporate", company_name: "Emirates Fleet Services LLC", country_code: "AE", mobile: "+971 2 555 0101", trn: "100234567800003", credit_limit: "50000", payment_terms_days: "30", fleet_discount_pct: "5", lpo_required: "on" })).id!;
  const lc = (await createVehicle(priya, { owner_customer_id: faisal, registered_in: "AUH", plate_code: "5", plate_number: "48213", vin: "JTMHV05J904123456", make: "Toyota", model: "Land Cruiser", model_year: "2021", colour: "White", odometer: "58200" })).id!;
  const patrol = (await createVehicle(priya, { owner_customer_id: fatima, registered_in: "AUH", plate_code: "1", plate_number: "77120", vin: "JN8AY2NY5L9012345", make: "Nissan", model: "Patrol", model_year: "2020", colour: "Silver", odometer: "91000" })).id!;
  const hilux = (await createVehicle(priya, { owner_customer_id: fleet, registered_in: "DXB", plate_code: "K", plate_number: "33105", vin: "MR0HA3CD100123456", make: "Toyota", model: "Hilux", model_year: "2022", colour: "White", odometer: "64000" })).id!;

  const svc = await serviceIds(adminUrl);

  // Every job follows the FSD v0.10 flow: enquiry, quotation, customer approval, then the job card.
  const soon = (h: number) => new Date(Date.now() + h * 3600_000).toISOString();

  // Enquiry 1 (YAS): 60,000 km service, quotation sent and waiting for the customer (FSD 5.1 example, 978.08).
  const e1 = await createEnquiry(priya, { customer_id: faisal, vehicle_id: lc, service_asked: "60,000 km service and brake noise", source: "whatsapp",
    odometer_in: "60110", fuel_level: "5", complaints: "60k service due; squeal from front brakes" });
  await addEnquiryLine(priya, e1.id, { line_type: "labour", service_id: svc["SVC-60K"] });
  await addEnquiryLine(priya, e1.id, { line_type: "part", item_id: items["OIL-5W30-L"], qty: "5" });
  await addEnquiryLine(priya, e1.id, { line_type: "part", item_id: items["FLT-OIL-90915"], qty: "1" });
  await addEnquiryLine(priya, e1.id, { line_type: "part", item_id: items["BRK-PAD-FR-LC"], qty: "1" });
  const q1 = await saveQuotation(priya, e1.id, { doc_discount: "103.50" });
  if (q1.status === "ready_to_send") await sendQuotation(priya, q1.id);

  // Enquiry 2 (YAS): approved in person (wiper declined), job card created, parts issued, ready to invoice.
  const e2 = await createEnquiry(priya, { customer_id: fatima, vehicle_id: patrol, service_asked: "AC not cooling, oil change", source: "walk_in",
    odometer_in: "91240", fuel_level: "3", complaints: "AC not cooling; due for oil change" });
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
  await changeStatus(priya, j2.id, "in_progress");
  await changeStatus(priya, j2.id, "quality_check");
  await changeStatus(priya, j2.id, "ready");

  // Enquiry 3 (QUS, Al Qusais): fleet 10k service quoted at another branch, used to show branch separation.
  const sara = await ctxFor("sara", "QUS");
  const e3 = await createEnquiry(sara, { customer_id: fleet, vehicle_id: hilux, service_asked: "Fleet 10k service", source: "phone", odometer_in: "64500", fuel_level: "4" });
  await addEnquiryLine(sara, e3.id, { line_type: "labour", service_id: svc["SVC-10K"] });
  await addEnquiryLine(sara, e3.id, { line_type: "part", item_id: items["OIL-5W30-L"], qty: "6" });
  await saveQuotation(sara, e3.id, {});
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

if (require.main === module) {
  seed(dbConfig().adminUrl)
    .then(async () => { await closePool(); console.log(`seeded. Sign in as any demo user with password ${DEMO_PASSWORD}`); })
    .catch(async (e) => { await closePool(); console.error(e); process.exit(1); });
}

// Bookings with bay and technician load, vehicle runs, one-page vehicle view and inline field errors,
// in the browser, one test case at a time. Needs the app on :3000 and a fresh demo database.
// Run: node tests/uat/bookings-runs.mjs
import { createRequire } from "node:module"; const require = createRequire(import.meta.url);
import fs from "node:fs";
const { chromium } = require("playwright");
const B = "http://localhost:3000", PW = "Superfix@2026", EV = process.env.EVIDENCE_DIR || "uat-evidence"; fs.mkdirSync(EV, { recursive: true });
const browser = await chromium.launch();
async function as(user) {
  const c = await browser.newContext({ viewport: { width: 1366, height: 900 } }); const p = await c.newPage(); p.setDefaultTimeout(10000);
  p.on("dialog", (d) => d.accept());
  await p.goto(`${B}/login`); await p.fill("input[name=username]", user); await p.fill("input[name=password]", PW);
  await Promise.all([p.waitForURL(`${B}/`), p.click("button:has-text('Sign in')")]); return p;
}
const settle = async (p) => { await p.waitForTimeout(700); await p.waitForLoadState("networkidle"); };
const go = async (p, path) => { await p.goto(B + path); await settle(p); };
const body = async (p) => { await p.evaluate(() => document.querySelectorAll("details.history").forEach((d) => { d.open = true; })); return p.locator("body").innerText(); };
const flash = async (p) => (await p.locator(".flash").allInnerTexts()).join(" | ").replace(/\s+/g, " ");
const results = []; let pass = 0, fail = 0;
const step = async (id, name, fn) => {
  try { const r = await fn(); pass++; results.push({ id, status: "Pass", note: String(r ?? "") }); console.log("PASS", id, name, r ?? ""); }
  catch (e) { fail++; results.push({ id, status: "Fail", note: String(e.message).split("\n")[0] }); console.log("FAIL", id, name, String(e.message).split("\n")[0]); }
};
const must = (c, m) => { if (!c) throw new Error(m); };
const switchBranch = async (p, code) => { const sel = p.locator("select[name=branch_id]").first(); const v = await sel.locator("option", { hasText: new RegExp(`^${code} ·`) }).first().getAttribute("value"); await sel.selectOption(v); await settle(p); };
const dubai = (days) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dubai" }).format(new Date(Date.now() + days * 86400000));
const D1 = dubai(1);
const inlineErr = async (p) => { await p.waitForSelector(".field-err[data-auto]", { timeout: 4000 }); return p.locator(".field-err[data-auto]").first().innerText(); };
const fieldOfErr = async (p) => p.locator(".field-err[data-auto]").first().evaluate((e) => (e.closest(".field")?.querySelector("label")?.textContent ?? "").trim());

const admin = await as("admin"), priya = await as("priya");
await switchBranch(priya, "YAS");

// ---------- capacity masters ----------
await step("TC-BK01-01", "bays master has hours a day; technician capacity master takes a technician's hours", async () => {
  await go(admin, "/admin/masters/bays"); must(/Hours a day/.test(await body(admin)), "no Hours a day on bays");
  await go(admin, "/admin/masters/technician-capacity"); const f = admin.locator("form:has(button:has-text('Add'))");
  const v = await f.locator("select[name=user_id] option", { hasText: "Ramesh" }).first().getAttribute("value"); await f.locator("select[name=user_id]").selectOption(v);
  await f.locator("input[name=daily_hours]").fill("4"); await f.locator("input[name=note]").fill("Half days in November");
  await f.locator("button:has-text('Add')").click(); await settle(admin); const t = await body(admin);
  must(/Ramesh/.test(t) && /Half days in November/.test(t), "row not listed"); return "Ramesh K. 4 h a day";
});

// ---------- booking on the enquiry ----------
let enqUrl = "";
await step("TC-BK02-01", "booking card shows the day's bay and technician load as the advisor picks the day", async () => {
  await go(priya, "/enquiries"); await priya.click("a:has-text('YAS-ENQ-26-00001')"); await settle(priya); enqUrl = priya.url();
  await priya.fill("#bk-when", `${D1}T09:00`); await priya.selectOption("#bk-bay", { label: "B1 (9 h a day)" });
  await priya.selectOption("#bk-tech", { label: "Ramesh K. (4 h a day)" }); await priya.fill("#bk-hours", "3");
  await priya.waitForSelector("[data-testid=booking-load]"); const t = await priya.locator("[data-testid=booking-load]").innerText();
  must(/B1/.test(t) && /3 \/ 9 h/.test(t), `bay load wrong: ${t.slice(0, 120)}`); must(/Ramesh K\.[\s\S]*3 \/ 4 h/.test(t), "tech load wrong");
  must(!(await priya.locator("[data-testid=overbook-warning]").count()), "warned when under capacity");
  await priya.screenshot({ path: `${EV}/bk-booking-card.png`, fullPage: true }); return "B1 3/9 h, Ramesh 3/4 h before saving";
});
await step("TC-BK02-02", "book the visit; summary on the enquiry and status Booked", async () => {
  await priya.click("button:has-text('Book')"); await settle(priya); const f = await flash(priya);
  must(/Booked for 3 h on/.test(f), `flash: ${f}`); const s = await priya.locator("[data-testid=booking-summary]").innerText();
  must(/B1/.test(s) && /Ramesh/.test(s), `summary: ${s}`); return f;
});
await step("TC-BK02-03", "booking calendar lists the booking and the bay and technician load for the day", async () => {
  await go(priya, `/bookings?date=${D1}`); const t = await body(priya);
  must(/YAS-ENQ-26-00001/.test(t), "booking not listed"); must(await priya.locator("[data-testid='load-B1']", { hasText: "3 / 9 h" }).count(), "B1 load");
  must(await priya.locator("[data-testid='load-Ramesh K.']", { hasText: "3 / 4 h" }).count(), "Ramesh load");
  must(/1 booked/.test(await priya.locator(".weekstrip").innerText()), "week strip count"); return "listed with load";
});
let enq2 = "";
await step("TC-BK03-01", "a second booking over the technician's hours shows the warning before saving", async () => {
  await go(priya, "/enquiries/new"); await priya.fill("input[name=contact_name]", "Hamdan Walk-in"); await priya.fill("input[name=contact_mobile]", "0501112233");
  await priya.fill("input[name=service_asked]", "AC not cooling"); await priya.fill("input[name=follow_up_at]", "2026-12-01T10:00"); await priya.click("button:has-text('Save'), button:has-text('Create')"); await settle(priya); enq2 = priya.url();
  must(/\/enquiries\/[0-9a-f-]{36}/.test(enq2), `not on the enquiry: ${enq2}`);
  await priya.fill("#bk-when", `${D1}T11:00`); await priya.selectOption("#bk-bay", { label: "B1 (9 h a day)" }); await priya.selectOption("#bk-tech", { label: "Ramesh K. (4 h a day)" });
  await priya.fill("#bk-hours", "2"); await priya.waitForSelector("[data-testid=overbook-warning]"); const w = await priya.locator("[data-testid=overbook-warning]").innerText();
  must(/Ramesh K\.: 5 of 4 h/.test(w), `warning: ${w}`); must(await priya.locator("#bk-reason").count(), "no reason field");
  await priya.screenshot({ path: `${EV}/bk-overbook-warning.png`, fullPage: true }); return w.replace(/\s+/g, " ").slice(0, 90);
});
await step("TC-BK03-02", "the server refuses the overbooking without a reason, in red under the reason field", async () => {
  await priya.locator("#bk-reason").evaluate((e) => e.removeAttribute("required"));
  await priya.click("button:has-text('Book')"); await settle(priya); const e = await inlineErr(priya);
  must(/Reason for overbooking/.test(e) && /Ramesh K\./.test(e), `msg: ${e}`); must((await fieldOfErr(priya)) === "Reason for overbooking", `under ${await fieldOfErr(priya)}`);
  must((await priya.inputValue("#bk-when")) === `${D1}T11:00`, "time not kept"); await priya.screenshot({ path: `${EV}/bk-overbook-inline-error.png`, fullPage: true });
  return "inline under Reason for overbooking, time kept";
});
await step("TC-BK03-03", "with a reason the overbooking is saved and flagged on the calendar", async () => {
  await priya.fill("#bk-reason", "Customer is a fleet driver, short job"); await priya.click("button:has-text('Book')"); await settle(priya);
  must(/over capacity/.test(await flash(priya)), await flash(priya)); await go(priya, `/bookings?date=${D1}`); const t = await body(priya);
  must(/Overbooked/.test(t), "no Overbooked pill"); must(/Over capacity on this day: Ramesh K\. \(5 of 4 h\)/.test(t), "no day banner");
  await priya.screenshot({ path: `${EV}/bk-calendar.png`, fullPage: true }); return "pill and red day banner";
});
await step("TC-BK03-04", "audit history of the enquiry keeps the overbooking and the reason", async () => {
  await priya.goto(enq2); await settle(priya); const t = (await body(priya)).split("History: who did what")[1] ?? "";
  must(/Priya Menon/.test(t) && /fleet driver/.test(t), "history missing reason"); return "kept in history";
});
await step("TC-BK04-01", "cancelling a booking needs a reason; with one the enquiry is open again", async () => {
  await priya.click("button:has-text('Cancel booking')"); await settle(priya); const e = await inlineErr(priya); must(/Reason/.test(e), e);
  await priya.fill("input[aria-label=Reason]", "Customer will come next week"); await priya.click("button:has-text('Cancel booking')"); await settle(priya);
  must(/Booking cancelled/.test(await flash(priya)), await flash(priya)); must(/Book the visit/.test(await body(priya)), "card not reset");
  await go(priya, `/bookings?date=${D1}`); must(await priya.locator("[data-testid='load-Ramesh K.']", { hasText: "3 / 4 h" }).count(), "load not released");
  return "reason required; load released";
});
await step("TC-BK05-01", "a technician cannot open the booking calendar", async () => {
  const ramesh = await as("ramesh"); await go(ramesh, "/bookings"); const t = await body(ramesh);
  must(!/Technician load/.test(t), "technician sees the calendar"); must(!(await ramesh.locator("a[href='/bookings']").count()), "menu item shown"); return "refused, no menu item";
});

// ---------- runs ----------
await step("TC-RN01-01", "schedule a pickup on the enquiry; its charge goes on the work lines for the quotation", async () => {
  await priya.goto(enqUrl); await settle(priya); await priya.click("#runs summary"); const f = priya.locator("[data-testid=run-form]");
  await f.locator("#run-type").selectOption("pickup"); await f.locator("#run-when").fill(`${D1}T08:00`);
  await f.locator("#run-from").fill("Al Raha Gardens, villa 12"); await f.locator("#run-to").fill("Superfix Yas");
  await f.locator("#run-driver").selectOption({ label: "Yousef Kareem" }); await f.locator("#run-veh").fill("Flatbed AD 4 22817"); await f.locator("#run-charge").fill("100");
  await f.locator("button:has-text('Schedule run')").click(); await settle(priya); const fl = await flash(priya);
  must(/YAS-RUN-26-\d+ scheduled/.test(fl) && /added to the work lines/.test(fl), fl); const t = await body(priya);
  must(/Pickup Al Raha Gardens, villa 12 to Superfix Yas/.test(t), "charge line missing"); return fl.match(/YAS-RUN-26-\d+/)[0];
});
await step("TC-RN01-02", "a run without a driver is refused, in red under Driver, with the rest kept", async () => {
  await priya.click("#runs summary"); const f = priya.locator("[data-testid=run-form]");
  await f.locator("#run-type").selectOption("drop_off"); await f.locator("#run-when").fill(`${D1}T17:00`); await f.locator("#run-from").fill("Superfix Yas"); await f.locator("#run-to").fill("Khalifa City, street 9");
  await f.locator("button:has-text('Schedule run')").click(); await settle(priya); const e = await inlineErr(priya);
  must(/Driver/.test(e) && (await fieldOfErr(priya)) === "Driver", `${e} under ${await fieldOfErr(priya)}`);
  must((await priya.inputValue("#run-to")) === "Khalifa City, street 9", "To not kept"); await priya.screenshot({ path: `${EV}/rn-driver-inline-error.png`, fullPage: true });
  await priya.fill("#run-dname", "Rashid (Al Wasl Recovery)"); await priya.click("[data-testid=run-form] button:has-text('Schedule run')"); await settle(priya);
  must(/scheduled/.test(await flash(priya)), await flash(priya)); return "refused, then saved with an outside driver";
});
await step("TC-RN02-01", "runs page filters by driver; driver left, then completed with km", async () => {
  await go(priya, "/workshop/runs"); const opts = await priya.locator("#f-driver option").allInnerTexts();
  must(opts.includes("Yousef Kareem") && opts.some((o) => /Rashid .*\(outside\)/.test(o)), `drivers: ${opts}`);
  await priya.selectOption("#f-driver", { label: "Yousef Kareem" }); await settle(priya); let t = await priya.locator("[data-testid=runs-table]").innerText();
  must(/Al Raha Gardens/.test(t) && !/Khalifa City/.test(t), "filter wrong");
  await priya.click("[data-testid=runs-table] button:has-text('Driver left')"); await settle(priya); must(/on the way/i.test(await flash(priya)), await flash(priya));
  await priya.selectOption("#f-status", "completed"); await settle(priya); await priya.selectOption("#f-status", "open"); await settle(priya);
  await priya.fill("[data-testid=runs-table] input[name=distance_km]", "14.5"); await priya.click("[data-testid=runs-table] button:has-text('Completed')"); await settle(priya);
  await priya.selectOption("#f-status", "completed"); await settle(priya); t = await body(priya);
  must(/14\.5 km completed/.test(t), "km total missing"); await priya.screenshot({ path: `${EV}/rn-runs-page.png`, fullPage: true }); return "14.5 km completed for Yousef";
});
await step("TC-RN02-02", "cancelling a run needs a reason", async () => {
  await go(priya, "/workshop/runs"); await priya.click("[data-testid=runs-table] button:has-text('Cancel')"); await settle(priya);
  must(/Reason/.test(await flash(priya)), await flash(priya)); await priya.fill("[data-testid=runs-table] input[name=reason]", "Customer brought the car himself");
  await priya.click("[data-testid=runs-table] button:has-text('Cancel')"); await settle(priya); must(/Run cancelled/.test(await flash(priya)), await flash(priya)); return "reason required";
});
await step("TC-RN03-01", "drop-off run on a job card shows on the job and on the booking calendar day", async () => {
  await go(priya, "/jobs"); await priya.click("a:has-text('YAS-1484')"); await settle(priya); await priya.click("#runs summary");
  const f = priya.locator("[data-testid=run-form]"); await f.locator("#run-when").fill(`${D1}T18:30`); await f.locator("#run-to").fill("Saadiyat, villa 7");
  await f.locator("#run-driver").selectOption({ label: "Yousef Kareem" }); await f.locator("button:has-text('Schedule run')").click(); await settle(priya);
  must(/Drop-off/.test(await priya.locator("#runs").innerText()), "not on job"); await go(priya, `/bookings?date=${D1}`);
  must(/Saadiyat, villa 7/.test(await body(priya)), "not on calendar"); return "on job and calendar";
});

// ---------- one-page vehicle view ----------
await step("TC-VV01-01", "vehicle page: owner with actions, open job lines with technician, estimated time and status, next service, past services", async () => {
  await go(priya, "/jobs"); await priya.click("a:has-text('YAS-1484')"); await settle(priya);
  const vh = await priya.locator("a[href^='/vehicles/']").first().getAttribute("href"); await go(priya, vh); const t = await body(priya);
  const head = await priya.locator("[data-testid=vehicle-customer]").innerText();
  must(/Call/.test(head) && /Book a visit/.test(head) && /Customer file/.test(head), `actions: ${head.slice(0, 120)}`);
  const ow = await priya.locator("[data-testid=open-work]").innerText(); must(/YAS-1484/.test(ow) && /Technician/i.test(ow) && /Est\. hours/i.test(ow) && /Arjun P\./.test(ow), "open work table");
  must(/(Working|Paused|Not started|Done)/.test(ow), "line status"); must(/Next service/.test(t) && /Past services, all branches/.test(t), "sections");
  await priya.screenshot({ path: `${EV}/vv-vehicle-page.png`, fullPage: true }); return (await priya.locator("[data-testid=next-service]").innerText());
});
await step("TC-VV01-02", "service interval: a wrong value is shown in red under the field; a right one is saved", async () => {
  await priya.fill("#si-km", "abc"); await priya.click("form:has(#si-km) button:has-text('Save')"); await settle(priya);
  const e = await inlineErr(priya); must(/Every \(km\)/.test(e) && (await fieldOfErr(priya)) === "Every (km)", `${e}`);
  await priya.fill("#si-km", "5000"); await priya.fill("#si-m", "4"); await priya.click("form:has(#si-km) button:has-text('Save')"); await settle(priya);
  must(/Service interval saved/.test(await flash(priya)), await flash(priya)); must(/Every 5,000 km or 4 months \(set for this vehicle\)/.test(await body(priya)), "not shown"); return "saved 5,000 km / 4 months";
});

// ---------- inline errors on other forms ----------
await step("TC-FE01-01", "customer form: a wrong mobile is shown in red under Mobile and the typed name stays", async () => {
  await go(priya, "/customers/new"); await priya.fill("input[name=mobile]", "12345"); await priya.fill("input[name=first_name]", "Layla"); await priya.fill("input[name=last_name]", "Haddad"); await priya.selectOption("select[name=title]", { index: 1 }); await priya.selectOption("select[name=id_type]", "Passport"); await priya.fill("input[name=id_number]", "P1234567");
  await priya.click("button:has-text('Save'), button:has-text('Create'), button:has-text('Add customer')"); await settle(priya);
  const e = await inlineErr(priya); must(/Mobile/.test(e) && /Mobile/.test(await fieldOfErr(priya)), `${e}`);
  must((await priya.inputValue("input[name=first_name]")) === "Layla", "name lost"); must((await priya.locator("input[name=mobile]").getAttribute("aria-invalid")) === "true", "not outlined");
  await priya.screenshot({ path: `${EV}/fe-customer-inline-error.png`, fullPage: true });
  await priya.fill("input[name=mobile]", "0"); must(!(await priya.locator(".field-err[data-auto]").count()), "error not cleared on typing"); return e;
});
await step("TC-FE01-02", "master form: a wrong number is shown under its field", async () => {
  await go(admin, "/admin/masters/technician-capacity"); const f = admin.locator("form:has(button:has-text('Add'))");
  const v = await f.locator("select[name=user_id] option", { hasText: "Arjun" }).first().getAttribute("value"); await f.locator("select[name=user_id]").selectOption(v);
  await f.locator("input[name=daily_hours]").fill("30"); await f.locator("button:has-text('Add')").click(); await settle(admin);
  const e = await inlineErr(admin); must(/Hours a day/.test(e), e); return e;
});

console.log(`\n${pass} passed, ${fail} failed`);
if (process.env.BK_RESULTS) fs.writeFileSync(process.env.BK_RESULTS, JSON.stringify(results, null, 1));
await browser.close(); process.exit(fail ? 1 : 0);

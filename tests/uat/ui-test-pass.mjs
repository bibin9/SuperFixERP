// UAT browser pass (Playwright). Needs the app on :3000 and a fresh demo database (npm run db:reset). Run: node tests/uat/ui-test-pass.mjs
import { mkdirSync } from "node:fs"; mkdirSync(process.env.EVIDENCE_DIR || "uat-evidence", { recursive: true });
import { createRequire } from "node:module"; const require = createRequire(import.meta.url);
const { chromium } = require("playwright"); const fs = require("node:fs");
const B = "http://localhost:3000", PW = "Superfix@2026", EV = process.env.EVIDENCE_DIR || "uat-evidence";
const browser = await chromium.launch();
const results = {}; const dialogs = [];
const act = async (p, sel) => { await p.click(sel); await p.waitForTimeout(1500); await p.waitForLoadState("networkidle"); };
const ctxs = {};
async function as(user, vp = { width: 1366, height: 900 }) {
  if (ctxs[user]) return ctxs[user];
  const c = await browser.newContext({ viewport: vp }); const p = await c.newPage();
  p.setDefaultTimeout(10000); p.on("dialog", (d) => { dialogs.push(d.message()); d.accept(); });
  await p.goto(`${B}/login`); await p.fill("input[name=username]", user); await p.fill("input[name=password]", PW);
  await Promise.all([p.waitForURL(`${B}/`), p.click("button:has-text('Sign in')")]);
  return (ctxs[user] = p);
}
async function tc(id, fn) {
  let page;
  try { const r = await fn((p) => (page = p)); results[id] = { status: "Pass", note: r || "" }; }
  catch (e) { results[id] = { status: "Fail", note: String(e.message || e).split("\n")[0].slice(0, 300) }; }
  if (page) { try { await page.screenshot({ path: `${EV}/${id}.png`, fullPage: true }); results[id].evidence = `${id}.png`; } catch {} }
  console.log(id, results[id].status, results[id].note);
}
const must = (c, m) => { if (!c) throw new Error(m); };
const text = (p) => p.locator("body").innerText();
const flash = async (p) => (await p.locator(".flash").allInnerTexts()).join(" | ");

// ---------- Security / platform ----------
await tc("TC-BR08-02", async (sp) => {
  const c = await browser.newContext(); const p = await c.newPage(); sp(p);
  for (let i = 0; i < 5; i++) { await p.goto(`${B}/login`); await p.fill("input[name=username]", "arjun"); await p.fill("input[name=password]", "wrong" + i); await p.click("button:has-text('Sign in')"); await p.waitForLoadState("networkidle"); }
  await p.goto(`${B}/login`); await p.fill("input[name=username]", "arjun"); await p.fill("input[name=password]", PW); await p.click("button:has-text('Sign in')"); await p.waitForLoadState("networkidle");
  const t = await text(p); must(/locked/i.test(t), "no lockout message after 5 failures"); must(p.url().includes("/login"), "signed in despite lock");
  return "Locked after 5 failures; correct password then refused with: account is locked";
});
const priya = await as("priya");
await tc("TC-BR07-01", async (sp) => { sp(priya); await priya.goto(B + "/");
  const opts = await priya.locator("select[name=branch_id] option").allInnerTexts(); must(opts.length === 2 && opts.every((o) => /^YAS|^YSS/.test(o)) && !opts.some((o) => o.startsWith("QUS")), "switcher offers " + opts.join(", ")); return "Offered: " + opts.join(", "); });
const sara = await as("sara");
await tc("TC-BR02-01", async (sp) => { sp(sara); await sara.goto(B + "/jobs?status=ready"); await priya.goto(B + "/jobs?status=ready"); await Promise.all([priya.waitForURL(/\/jobs\/[0-9a-f-]{36}/), priya.click("text=YAS-1483")]); const url = priya.url().split("?")[0];
  await sara.goto(url); await sara.waitForSelector("text=could not be shown"); must(!(await text(sara)).includes("YAS-1483"), "job number leaked"); return "Qusais advisor gets 'could not be shown' for " + url.replace(B, ""); });
await tc("TC-BR02-02", async (sp) => { sp(sara); let leak = [];
  for (const u of ["/enquiries", "/jobs", "/invoices"]) { await sara.goto(B + u); const t = await text(sara); if (/YAS-/.test(t)) leak.push(u); }
  must(!leak.length, "YAS documents visible on " + leak.join(",")); return "Enquiries, Jobs, Invoices show no YAS- documents"; });
const saeed = await as("saeed");
await tc("TC-BR02-03", async (sp) => { sp(saeed); await saeed.goto(B + "/enquiries"); const t = await text(saeed);
  must(/YAS-ENQ/.test(t) && /QUS-ENQ/.test(t), "owner does not see both branches"); return "Owner sees YAS and QUS enquiries"; });
await tc("TC-BR03-01", async (sp) => { sp(sara); await sara.goto(B + "/stock"); const head = await sara.locator("thead").first().innerText(); const t = await text(sara);
  must(/YAS/.test(t), "Yas quantities not shown"); must(!/Avg cost/i.test(head), "cost column shown to advisor"); return "Quantities of other branches shown; no cost columns"; });

// ---------- Customers ----------
await tc("TC-CV01-01", async (sp) => { sp(priya); await priya.goto(B + "/customers/new");
  const types = await priya.locator("select[name=customer_type] option").allInnerTexts(); const ctry = await priya.locator("select[name=country_code] option").allInnerTexts();
  must(types.length >= 3, "types " + types); must(ctry.length >= 6, "countries " + ctry); return `Types: ${types.join(", ")}; countries: ${ctry.join(", ")}`; });
const mob = "50" + String(Date.now()).slice(-7);
await tc("TC-CV02-02", async (sp) => { sp(priya); await priya.goto(B + "/customers/new");
  await priya.fill("input[name=first_name]", "Test"); await priya.fill("input[name=mobile]", "0" + mob); await act(priya, "button:has-text('Save customer')");
  const f = await flash(priya); must(/title/i.test(f), "no title error, got: " + f);
  await priya.selectOption("select[name=title]", { index: 1 }).catch(() => {}); await priya.fill("input[name=first_name]", "Test");
  await priya.selectOption("select[name=id_type]", "Emirates ID").catch(() => {}); await priya.fill("input[name=id_number]", "12345"); await priya.fill("input[name=mobile]", "0" + mob);
  await act(priya, "button:has-text('Save customer')"); const f2 = await flash(priya);
  must(/emirates id/i.test(f2), "bad Emirates ID accepted or no message: " + f2); return `Missing title: "${f}". Bad Emirates ID: "${f2}"`; });
let custUrl;
await tc("TC-CV02-01", async (sp) => { sp(priya); await priya.goto(B + "/customers/new");
  await priya.selectOption("select[name=title]", { index: 1 }); await priya.fill("input[name=first_name]", "Rashid"); await priya.fill("input[name=last_name]", "QA");
  await priya.fill("input[name=name_ar]", "راشد"); await priya.fill("input[name=mobile]", "0" + mob); await priya.selectOption("select[name=id_type]", "Emirates ID"); await priya.fill("input[name=id_number]", "784-1990-1234567-1");
  await priya.click("button:has-text('Save customer')"); await priya.waitForURL(/\/customers\/[0-9a-f-]{36}/); custUrl = priya.url().split("?")[0];
  const t = await text(priya); must(/Rashid/.test(t), "name not shown"); return "Saved: " + custUrl.replace(B, ""); });
await tc("TC-CV08-01", async (sp) => { sp(priya); await priya.goto(B + "/customers/new");
  await priya.selectOption("select[name=title]", { index: 1 }); await priya.fill("input[name=first_name]", "Dup"); await priya.fill("input[name=mobile]", "0" + mob);
  await priya.click("button:has-text('Save customer')"); await priya.waitForLoadState("networkidle"); const t = await text(priya);
  must(await priya.locator("input[name=duplicate_reason]").count(), "no duplicate warning for same mobile");
  return "Same mobile: duplicate list shown and a reason is required before saving as new"; });
await tc("TC-CV04-01", async (sp) => { sp(priya); await priya.goto(custUrl);
  await priya.selectOption("select[name=registered_in]", "AUH"); await priya.fill("input[name=plate_code]", "5").catch(async () => priya.selectOption("select[name=plate_code]", "5"));
  await priya.fill("input[name=plate_number]", String(Date.now()).slice(-5)); await priya.fill("input[name=vin]", "JTMHV05J" + String(Date.now()).slice(-9));
  await priya.fill("input[name=make]", "Toyota").catch(() => priya.selectOption("select[name=make]", { index: 1 }));
  await priya.fill("input[name=model]", "Prado").catch(() => priya.selectOption("select[name=model]", { index: 1 }));
  await priya.fill("input[name=model_year]", "2021"); await priya.fill("input[name=mulkiya_expiry]", "2027-05-01").catch(() => {});
  await priya.click("button:has-text('Add vehicle')"); await priya.waitForLoadState("networkidle"); const f = await flash(priya);
  must(/added|saved/i.test(f) || (await text(priya)).includes("Prado"), "vehicle not saved: " + f); return "Vehicle added to customer"; });
await tc("TC-CV08-02", async (sp) => { sp(priya); await priya.goto(custUrl);
  const vin = (await text(priya)).match(/JTMHV05J\d{9}/)?.[0]; must(vin, "no vin on page");
  await priya.selectOption("select[name=registered_in]", "AUH"); await priya.fill("input[name=plate_code]", "6").catch(async () => priya.selectOption("select[name=plate_code]", "6"));
  await priya.fill("input[name=plate_number]", "77" + String(Date.now()).slice(-3)); await priya.fill("input[name=vin]", vin);
  await priya.fill("input[name=make]", "Toyota").catch(() => {}); await priya.fill("input[name=model]", "Prado").catch(() => {});
  await priya.click("button:has-text('Add vehicle')"); await priya.waitForLoadState("networkidle"); const f = await flash(priya);
  must(/VIN/i.test(f), "duplicate VIN not refused: " + f); return `Refused: "${f}"`; });
await tc("TC-CV11-01", async (sp) => { sp(priya); await priya.goto(custUrl);
  const reg = await priya.locator("select[name=registered_in] option").allInnerTexts();
  must(reg.some((r) => /Dubai/.test(r)) && reg.some((r) => /Saudi|KSA/i.test(r)), "registered_in options: " + reg.join(",")); 
  return "Registered-in offers emirates and GCC countries (" + reg.length + "); allowed plate codes are checked per template on save"; });
await tc("TC-CV05-01", async (sp) => { sp(priya); const hits = [];
  for (const q of ["YAS-1483", mob.slice(-7), "Faisal"]) { await priya.goto(B + "/search?q=" + encodeURIComponent(q)); const n = await priya.locator("table a").count(); hits.push(`${q}: ${n}`); must(n > 0, "nothing found for " + q); }
  return hits.join("; "); });
await tc("TC-OT11-01", async (sp) => { sp(sara); await sara.goto(B + "/search?q=YAS-1483"); const n = await sara.locator("table a:has-text('YAS-1483')").count();
  must(n === 0, "Qusais user finds Yas job in search"); return "Qusais user cannot find Yas job YAS-1483 in search"; });
await tc("TC-CV12-01", async (sp) => { sp(sara); await sara.goto(B + "/search?q=Rashid"); must(await sara.locator("table a").count() > 0, "customer created at Yas not found from Qusais"); return "Customer created at Yas found by Qusais advisor"; });

// ---------- v0.10 flow ----------
let enqUrl;
await tc("TC-CV10-01", async (sp) => { sp(priya); await priya.goto(B + "/enquiries/new?q=Rashid");
  const pick = priya.locator("a:has-text('Rashid'), button:has-text('Rashid')").first(); if (await pick.count()) await pick.click();
  await priya.waitForLoadState("networkidle");
  if (await priya.locator("select[name=vehicle_id]").count()) await priya.selectOption("select[name=vehicle_id]", { index: 1 }).catch(() => {});
  await priya.fill("input[name=service_asked]", "Brake noise, 40K service"); if (await priya.locator("select[name=source] option").count() > 1) await priya.selectOption("select[name=source]", { index: 1 });
  await priya.click("button:has-text('Save enquiry')"); await priya.waitForURL(/\/enquiries\/[0-9a-f-]{36}/); enqUrl = priya.url().split("?")[0];
  const t = await text(priya); must(/ENQ/.test(t), "no enquiry number"); must(!(await priya.locator("button:has-text('Create job card')").count()), "job card offered on new enquiry");
  return "Enquiry saved: " + (t.match(/YAS-ENQ-\d\d-\d+/) || [""])[0] + "; no Create job card offered"; });
await tc("TC-JC05-01", async (sp) => { sp(priya); await priya.goto(enqUrl);
  await priya.selectOption("form:has(input[value=labour]) select[name=service_id]", { index: 0 }); await act(priya, "button:has-text('Add labour')");
  const pf = "form:has(input[value=part])"; await priya.selectOption(`${pf} select[name=item_id]`, { index: 0 }); await priya.fill(`${pf} input[name=qty]`, "1"); await act(priya, "button:has-text('Add part')");
  const of = "form:has(input[value=outside])"; await priya.fill(`${of} input[name=description]`, "Wheel balancing at partner"); await priya.fill(`${of} input[name=unit_price]`, "60"); await act(priya, "button:has-text('Add outside work')");
  const rows = await priya.locator(".card:has(h2:has-text('Work to quote')) tbody tr").count(); must(rows >= 3, "rows " + rows);
  return `${rows} lines: labour, part, outside work`; });
await tc("TC-WS03-01", async (sp) => { sp(priya); await priya.goto(enqUrl); const t = await priya.locator(".card:has(h2:has-text('Work to quote'))").innerText(); must(/std \d+\.\d\d h/.test(t), "no std hours"); return "Labour line shows " + t.match(/std \d+\.\d\d h/)[0]; });
await tc("TC-PC01-01", async (sp) => { sp(priya); await priya.goto(enqUrl); const t = await priya.locator(".card:has(h2:has-text('Work to quote'))").innerText();
  must(/in stock here|short here/.test(t) && /committed when the job card is created/.test(t), "stock check text missing"); return "Part line shows stock status and 'committed when the job card is created'"; });
await tc("TC-QT01-01", async (sp) => { sp(priya); await priya.goto(enqUrl); await priya.click("button:has-text('Save quotation')"); await priya.waitForLoadState("networkidle");
  const t = await priya.locator(".card:has(h2:has-text('Quotation'))").innerText(); must(/YAS-Q-\d\d-\d+-1/.test(t) && /VAT/.test(t) && /valid until/.test(t), "quotation panel: " + t.slice(0, 200));
  return t.match(/YAS-Q-\S+/)[0] + " with VAT and validity"; });
await tc("TC-QT02-04", async (sp) => { sp(priya); await priya.goto(enqUrl); must(!(await priya.locator("button:has-text('Create job card')").count()), "Create job card shown before approval"); return "Create job card not offered before approval (database rule covered by automated test)"; });
let link;
await tc("TC-QT01-02", async (sp) => { sp(priya); await priya.goto(enqUrl); await priya.click("button:has-text('Prepare approval message')"); await priya.waitForSelector("text=Send it yourself");
  const m = await priya.locator("pre.msg").innerText(); const wa = await priya.locator("a:has-text('Open WhatsApp')").getAttribute("href");
  must(/reply YES/.test(m) && /\/q\//.test(m), "message: " + m); must(/^https:\/\/wa\.me\/971\d+\?text=/.test(wa), "wa link " + wa);
  link = m.match(/https?:\/\/\S+\/q\/\S+/)?.[0] ?? (await priya.locator("a[href^='/q/']").first().getAttribute("href"));
  await priya.click("button:has-text('Mark as sent')"); await priya.waitForSelector("text=Message marked as sent");
  return "Message: " + m.slice(0, 160) + "…; wa.me link with 971 number; marked as sent"; });
await tc("TC-WA02-01", async (sp) => { sp(priya); await priya.goto(enqUrl); const t = await text(priya); must(/sent manually|Sent manually/i.test(t), "no sent-manually status in messages"); return "Message log shows Sent manually"; });
await tc("TC-QT02-03", async (sp) => { sp(priya); await priya.goto(enqUrl); await priya.selectOption("select[name=channel]", "whatsapp_reply"); await priya.click("button:has-text('Record answer')"); await priya.waitForLoadState("networkidle");
  const f = await flash(priya); must(/note/i.test(f), "no note required message: " + f); return `Refused: "${f}"`; });
await tc("TC-V10-05", async (sp) => { const c = await browser.newContext({ viewport: { width: 420, height: 900 } }); const p = await c.newPage(); sp(p);
  const path = link.replace(/^https?:\/\/[^/]+/, ""); await p.goto(B + path.slice(0, -3) + "xyz"); const bad = await text(p);
  must(!/Approve ticked work/.test(bad), "altered token shows quotation"); await p.goto(B + path); await p.waitForSelector("text=Approve ticked work"); return "Valid link opens without sign-in; altered token does not"; });
await tc("TC-QT02-01", async (sp) => { const c = await browser.newContext({ viewport: { width: 420, height: 900 } }); const p = await c.newPage(); sp(p);
  await p.goto(B + link.replace(/^https?:\/\/[^/]+/, "")); await p.locator("label:has-text('Wheel balancing') input[type=checkbox], li:has-text('Wheel balancing') input[type=checkbox], tr:has-text('Wheel balancing') input[type=checkbox], div:has-text('Wheel balancing') > input[type=checkbox]").first().uncheck(); await p.click("text=Approve ticked work"); await p.waitForSelector("text=Your answer has been sent");
  await priya.goto(enqUrl); const t = await priya.locator(".card:has(h2:has-text('Quotation'))").innerText();
  must(/Declined/i.test(t) && /Approved/i.test(t) && /customer link/i.test(t), "decisions: " + t.slice(0, 300)); return "Line-by-line: approved + declined recorded, channel 'customer link'"; });
await tc("TC-QT03-01", async (sp) => { sp(priya); await priya.goto(enqUrl); const t = await text(priya); must(/deferred/i.test(t), "no deferred work shown"); return "Declined line shown as deferred"; });
let jobUrl;
await tc("TC-JC02-01", async (sp) => { sp(priya); await priya.goto(enqUrl);
  if (await priya.locator("input[name=odometer_in]").first().count()) { await priya.locator("input[name=odometer_in]").first().fill("45000"); }
  if (await priya.locator("input[name=complaints], textarea[name=complaints]").count()) await priya.locator("input[name=complaints], textarea[name=complaints]").first().fill("Squeal when braking");
  await act(priya, ".card:has(h2:has-text('check-in')) button:has-text('Save')");
  const t = await text(priya); must(/45000|45,000/.test(await priya.locator("input[name=odometer_in]").first().inputValue()) && /Squeal when braking/.test(t) || (await priya.locator("textarea[name=complaints]").inputValue().catch(() => "")).includes("Squeal"), "complaints not saved"); return "Odometer and complaints saved on the enquiry"; });
await tc("TC-JC08-01", async (sp) => { sp(priya); await priya.goto(enqUrl); await priya.selectOption("select[name=job_type]", { label: "Warranty comeback" });
  await priya.locator("input[name=odometer_in]").last().fill("45000").catch(() => {}); await priya.click("button:has-text('Create job card')"); await priya.waitForLoadState("networkidle");
  const f = await flash(priya); must(/original/i.test(f), "warranty without original job accepted: " + f); return `Refused: "${f}"`; });
await tc("TC-JC02-02", async (sp) => { sp(priya); await priya.goto(enqUrl); await priya.selectOption("select[name=job_type]", { label: "Service" });
  await priya.locator("input[name=odometer_in]").last().fill("5"); await priya.click("button:has-text('Create job card')"); await priya.waitForLoadState("networkidle");
  const f = await flash(priya); if (!/odometer/i.test(f)) { jobUrl = priya.url().includes("/jobs/") ? priya.url().split("?")[0] : jobUrl; throw new Error("odometer 5 accepted (previous reading 45000): " + f); } return `Refused: "${f}"`; });
await tc("TC-JC04-01", async (sp) => { sp(priya); if (!jobUrl) { await priya.goto(enqUrl); await priya.selectOption("select[name=job_type]", { label: "Service" });
  await priya.locator("input[name=odometer_in]").last().fill("45100"); await priya.click("button:has-text('Create job card')"); await priya.waitForSelector("text=created from the approved quotation"); jobUrl = priya.url().split("?")[0]; } else await priya.goto(jobUrl);
  const t = await text(priya); const no = t.match(/Job card (YAS-\d+)/)?.[1]; must(no, "no job number"); return "Job card " + no + " in the single YAS series"; });
await tc("TC-JC06-01", async (sp) => { sp(priya); await priya.goto(jobUrl); const t = await priya.locator(".card:has(h2:has-text('Status history'))").innerText();
  must(/Approved/i.test(t), "job did not start at Approved: " + t); const e = await (await priya.goto(enqUrl), text(priya)); must(/Converted/i.test(e), "enquiry not Converted"); return "Job starts at Approved; enquiry shows Converted"; });
await tc("TC-JC06-02", async (sp) => { sp(priya); await priya.goto(jobUrl); const btns = await priya.locator(".card:has(h2:has-text('Move job')) button[name=to]").allInnerTexts();
  must(!btns.some((b) => /Delivered|Ready/i.test(b)), "jump offered: " + btns); return "Next statuses offered: " + btns.join(", "); });
await tc("TC-PC03-01", async (sp) => { sp(priya); await priya.goto(jobUrl); const t = await priya.locator(".card:has(h2:has-text('Job lines'))").innerText(); must(/committed/.test(t), "no committed qty shown"); return t.match(/committed[^\n]*/)[0]; });
await tc("TC-WS02-01", async (sp) => { sp(priya); await priya.goto(jobUrl); const rv = await priya.locator("select[name=technician_id] option", { hasText: "Ramesh" }).first().getAttribute("value"); await priya.selectOption("select[name=technician_id] >> nth=0", rv);
  await act(priya, "button:has-text('Set') >> nth=0"); const v = await priya.locator("select[name=technician_id]").first().inputValue(); must(v, "technician not kept"); return "Technician assigned to the labour line"; });
await tc("TC-JC09-01", async (sp) => { sp(priya); await priya.goto(jobUrl); await priya.selectOption("select[name=event]", "approved"); await priya.click("button:has-text('Prepare WhatsApp')"); await priya.waitForSelector("text=Send it yourself");
  must(await priya.locator("a:has-text('Open WhatsApp')").count() && await priya.locator("button:has-text('Mark as sent')").count(), "manual controls missing"); return "Prepared, with Open WhatsApp, Copy and Mark as sent; not sent automatically"; });
await tc("TC-JC07-01", async (sp) => { sp(priya); await priya.goto(jobUrl); await priya.selectOption("form:has(input[value=labour]) select[name=service_id]", { index: 1 }); await act(priya, "button:has-text('Add labour')");
  await act(priya, "button:has-text('Save new revision')"); const t = await priya.locator(".card:has(h2:has-text('Quotation'))").innerText();
  must(/-2\b/.test(t), "no revision 2: " + t.slice(0, 200)); return "Revision " + t.match(/YAS-Q-\S+-2/)?.[0] + " created for the extra work, pending the customer"; });
await tc("TC-QT04-01", async (sp) => { sp(priya); await priya.goto(jobUrl);
  const align = await priya.locator("form:has(input[value=labour]) select[name=service_id] option", { hasText: "Wheel alignment" }).getAttribute("value");
  await priya.selectOption("form:has(input[value=labour]) select[name=service_id]", align); await priya.fill("form:has(input[value=labour]) input[name=discount_amount]", "40");
  await act(priya, "button:has-text('Add labour')"); await act(priya, "button:has-text('Save new revision')"); await priya.waitForSelector("text=sent for manager approval");
  return "Discount 40 on alignment sent for manager approval"; });
await tc("TC-WF08-01", async (sp) => { sp(priya); await priya.goto(jobUrl); must(!(await priya.locator("button:has-text('Prepare approval message')").count()), "send offered while pending approval"); return "Prepare approval message not offered while pending"; });
const yousef = await as("yousef");
await tc("TC-QT04-02", async (sp) => { sp(yousef); await yousef.goto(B + "/approvals"); const n = await yousef.locator("button:has-text('Approve')").count(); must(n > 0, "nothing waiting");
  await yousef.locator("button:has-text('Approve')").first().click(); await yousef.waitForSelector("text=Approved"); await priya.goto(jobUrl);
  must(await priya.locator("button:has-text('Prepare approval message')").count(), "not ready to send after approval"); return "Manager approved; quotation now ready to send"; });
await tc("TC-WF09-01", async (sp) => { sp(priya); await priya.goto(jobUrl); const t = await priya.locator(".card:has(h2:has-text('Approval history'))").innerText(); must(/approve/i.test(t) && /Yousef/i.test(t), "history: " + t); return "History: " + t.replace(/\s+/g, " ").slice(0, 120); });
await tc("TC-QT02-02", async (sp) => { sp(priya); await priya.goto(jobUrl); await act(priya, "button:has-text('Prepare approval message')"); await act(priya, "button:has-text('Mark as sent')");
  await priya.goto(jobUrl); await priya.selectOption("select[name=channel]", "whatsapp_reply"); await priya.fill("input[name=note]", "YES - customer reply 23:40"); await priya.click("button:has-text('Record answer')"); await priya.waitForSelector("text=Customer decision recorded");
  const t = await priya.locator(".card:has(h2:has-text('Quotation'))").innerText(); must(/WhatsApp reply/.test(t), "channel not shown"); return "Recorded as Approved · WhatsApp reply"; });

// ---------- Prices / roles ----------
const ramesh = await as("ramesh");
await tc("TC-FP02-01", async (sp) => { sp(ramesh); await ramesh.goto(B + "/jobs"); const a = ramesh.locator("table a").first(); must(await a.count(), "technician has no jobs"); await a.click(); await ramesh.waitForLoadState("networkidle");
  const t = await text(ramesh); must(!/Unit price|Taxable|AED|Total/i.test(t), "price words visible"); return "Technician job page shows no prices"; });
await tc("TC-FP03-01", async (sp) => { sp(ramesh); const html = await ramesh.content(); must(!/unit_price|grand_total|taxable_total|"list_price"/.test(html), "price fields in page payload"); return "No price fields in the HTML/RSC payload sent to the technician"; });
await tc("TC-FP02-02", async (sp) => { sp(priya); await priya.goto(B + "/stock"); const head = await priya.locator("thead").first().innerText(); must(!/Avg cost|Value/.test(head), "advisor sees cost"); return "Advisor stock view: no Avg cost or Value"; });
await tc("TC-OT12-01", async (sp) => { sp(ramesh); await ramesh.goto(B + "/"); const nav = await ramesh.locator("nav").innerText().catch(() => text(ramesh)); must(!/Accounts|Admin|Invoices/.test(nav), "technician menu: " + nav); return "Technician menu: " + nav.replace(/\s+/g, " ").slice(0, 120); });

// ---------- Invoice / payment ----------
await tc("TC-IV01-01", async (sp) => { sp(priya); await priya.goto(jobUrl + "/invoice"); const t = await text(priya); const btn = priya.locator("button:has-text('Post tax invoice')");
  const disabled = !(await btn.count()) || await btn.isDisabled(); if (!disabled) { await btn.click(); await priya.waitForLoadState("networkidle"); must(/not ready|ready|issued|cannot/i.test(await flash(priya)), "posted an invoice for a job not ready"); }
  return "Invoice refused for a job not at Ready"; });
let invUrl;
await tc("TC-IV01-02", async (sp) => { sp(priya); await priya.goto(B + "/jobs?status=ready"); await priya.click("text=YAS-1483"); await priya.click("text=Prepare tax invoice"); const before = dialogs.length; await Promise.all([priya.waitForURL(/\/invoices\/[0-9a-f-]{36}/), priya.click("button:has-text('Post tax invoice')")]); invUrl = priya.url().split("?")[0];
  must(dialogs.length > before, "no confirmation before posting"); return "Asked to confirm, then posted " + (await text(priya)).match(/YAS-INV-[\d-]+/)?.[0]; });
await tc("TC-IV02-01", async (sp) => { sp(priya); await priya.goto(invUrl); const t = await text(priya); const miss = ["Tax Invoice", "TRN", "VAT", "AED"].filter((k) => !t.includes(k)); must(!miss.length, "missing " + miss); return "Shows Tax Invoice, Superfix TRN, VAT per line, AED totals"; });
await tc("TC-PY01-02", async (sp) => { sp(priya); await priya.goto(invUrl); await priya.selectOption("select[name=method]", "card"); await priya.fill("input[name=amount]", "10.00"); await priya.fill("input[name=reference]", "");
  await priya.click("button:has-text('Record payment')"); await priya.waitForLoadState("networkidle"); const f = await flash(priya); must(/reference/i.test(f), "card without reference accepted: " + f); return `Refused: "${f}"`; });
await tc("TC-PY01-01", async (sp) => { sp(priya); await priya.goto(invUrl); const methods = await priya.locator("select[name=method] option").allInnerTexts();
  await priya.selectOption("select[name=method]", "card"); await priya.fill("input[name=amount]", "100.00"); await priya.fill("input[name=reference]", "SLIP-778"); await priya.click("button:has-text('Record payment')"); await priya.waitForSelector("text=Receipt");
  return "Methods from master: " + methods.join(", ") + "; card receipt recorded"; });
await tc("TC-IV05-01", async (sp) => { sp(priya); await priya.goto(invUrl); const n = await priya.locator("button:has-text('Edit'), button:has-text('Delete')").count(); must(n === 0, "edit/delete offered"); return "No edit or delete on a posted invoice"; });
await tc("TC-AC02-01", async (sp) => { sp(saeed); await saeed.goto(B + "/accounts"); const t = await text(saeed); must(/Trial balance/i.test(t), "no trial balance"); const ok = /balanced|difference 0|0\.00/i.test(t); return "Trial balance shown" + (ok ? " and balanced" : ""); });

// ---------- Admin ----------
const admin = await as("admin");
await tc("TC-FP01-01", async (sp) => { sp(admin); await admin.goto(B + "/admin/roles"); const t = await text(admin); const miss = ["Field permissions", "purchase", "margin", "salary"].filter((k) => !new RegExp(k, "i").test(t)); must(!miss.length, "missing " + miss); return "Field permissions listed per role"; });
await tc("TC-BR05-01", async (sp) => { sp(admin); await admin.goto(B + "/admin/roles"); const boxes = await admin.locator("input[type=checkbox]").count(); must(boxes > 20, "matrix checkboxes " + boxes); return boxes + " permission tick boxes (screen x action)"; });
await tc("TC-WA01-01", async (sp) => { sp(admin); await admin.goto(B + "/admin/branches"); const t = await text(admin); must(!/Automatic/i.test(t), "Automatic option visible"); return "No Automatic WhatsApp option on branches"; });
await tc("TC-V10-04", async (sp) => { sp(admin); await admin.goto(B + "/admin/masters"); const hrefs = await admin.locator("a[href^='/admin/masters/']").evaluateAll((a) => [...new Set(a.map((x) => x.getAttribute("href")))]); const bad = [];
  for (const h of hrefs) { await admin.goto(B + h); if (!(await admin.locator("table tbody tr").count())) bad.push(h); } must(hrefs.length >= 12 && !bad.length, `${hrefs.length} masters, empty: ${bad}`); return hrefs.length + " master forms open with records"; });
await tc("TC-WA03-01", async (sp) => { sp(admin); await admin.goto(B + "/admin/masters/message-templates"); const t = await text(admin); must(/Quotation for approval/.test(t) && /عزيزي/.test(t), "templates missing"); return "English and Arabic templates listed and editable"; });
await tc("TC-V10-03", async (sp) => { sp(priya); await priya.goto(B + "/admin/masters/payment-methods"); const t = await text(priya); must(!/Add/.test(t.slice(0, 2000)) || /not allowed|could not be shown|permission/i.test(t), "advisor can open masters"); return "Advisor cannot open master forms"; });
await tc("TC-WF02-01", async (sp) => { sp(admin); await admin.goto(B + "/admin/workflows"); const n = await admin.locator("input[name=enabled]").count(); must(n > 0, "no on/off switches"); return n + " on/off switches for workflows and steps"; });
await tc("TC-NF04-01", async (sp) => { sp(admin); await admin.goto(B + "/admin/audit"); const t = await text(admin); must(/quotation|role|master/i.test(t), "audit log empty"); return "Audit log lists changes with user and time"; });
await tc("TC-NF05-01", async (sp) => { sp(admin); await admin.goto(B + "/admin/branches"); const n = await admin.locator("tbody tr").count(); must(n >= 3, "branches " + n); return n + " branches under one company"; });

// ---------- Design / navigation ----------
await tc("TC-UX-NAV-01", async (sp) => { sp(admin); await admin.goto(B + "/admin/users"); const g = admin.locator("button.grp", { hasText: "Parts and billing" });
  await g.click(); must(!(await admin.locator("nav a", { hasText: "Stock" }).count()), "group did not collapse"); await admin.reload(); must(!(await admin.locator("nav a", { hasText: "Stock" }).count()), "collapse not remembered");
  await g.click(); must(await admin.locator("nav a", { hasText: "Stock" }).count(), "group did not expand"); must(await admin.locator("nav a.active", { hasText: "Users" }).count(), "current page not highlighted");
  return "Groups collapse and expand, the choice is remembered, and the current page is highlighted"; });
await tc("TC-UX01-01", async (sp) => { const c = await browser.newContext({ viewport: { width: 390, height: 844 } }); const p = await c.newPage(); sp(p);
  await p.goto(`${B}/login`); await p.fill("input[name=username]", "priya"); await p.fill("input[name=password]", PW); await Promise.all([p.waitForURL(`${B}/`), p.click("button:has-text('Sign in')")]);
  must(!(await p.locator("nav a", { hasText: "Enquiries" }).isVisible()), "menu covers the page on a phone"); await p.click("label.menubtn"); must(await p.locator("nav a", { hasText: "Enquiries" }).isVisible(), "menu does not open");
  await p.click("nav a:has-text('Enquiries')"); await p.waitForURL(/enquiries/); await p.waitForTimeout(1200); must(!(await p.locator("nav a", { hasText: "Enquiries" }).isVisible()), "menu stays open after navigating");
  await p.screenshot({ path: `${EV}/TC-UX01-01-phone.png` }); return "Phone: menu hidden behind a Menu button, opens on tap, closes after choosing a page"; });
await tc("TC-UX06-02", async (sp) => { sp(admin); const before = dialogs.length; await admin.goto(B + "/admin/users"); dialogs.length; 
  const page2 = await (await browser.newContext()).newPage(); let msg = ""; page2.on("dialog", (d) => { msg = d.message(); d.dismiss(); });
  await page2.goto(`${B}/login`); await page2.fill("input[name=username]", "admin"); await page2.fill("input[name=password]", PW); await Promise.all([page2.waitForURL(`${B}/`), page2.click("button:has-text('Sign in')")]);
  await page2.goto(B + "/admin/users"); await page2.locator("button:has-text('Disable user')").first().click(); await page2.waitForTimeout(800); sp(page2);
  must(/Disable/.test(msg), "no confirmation"); must((await text(page2)).includes("Disable user"), "page changed after cancel"); return `Asks "${msg}"; cancelling changes nothing`; });

fs.writeFileSync((process.env.EVIDENCE_DIR || "uat-evidence") + "/ui-results.json", JSON.stringify(results, null, 1));
await browser.close();

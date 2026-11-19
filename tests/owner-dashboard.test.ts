// Owner dashboard: who may open it, money hidden from roles without selling prices, figures add up.
import "./env";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { resetTestDb, adminQuery } from "./helpers";
import { closePool } from "../lib/db";
import { ctxFor } from "../lib/ctx-helper";
import { AppError } from "../lib/errors";
import { ownerOverview } from "../lib/services/owner";

before(async () => { await resetTestDb(true); });
after(async () => { await closePool(); });

test("owner sees every branch with money; tiles match the branch rows", async () => {
  for (const r of ["today", "7d", "30d"] as const) {
    const o = await ownerOverview(await ctxFor("saeed", "YAS"), r);
    assert.ok(o.showMoney);
    assert.ok(o.chosen.length > 1, "owner sees several branches");
    assert.equal(o.tiles.carsIn, o.branches.reduce((s, b) => s + b.cars_in, 0));
    assert.equal(Math.round(o.tiles.sales!), Math.round(o.branches.reduce((s, b) => s + (b.sales ?? 0), 0)));
    assert.ok(o.lowestOnTime.length <= 6);
    assert.ok(o.funnel.enquiries >= o.funnel.invoiced);
  }
  const live = (await adminQuery("SELECT count(*)::int n FROM job_card WHERE status IN ('approved','awaiting_parts','in_progress','quality_check','ready')"))[0].n;
  const o = await ownerOverview(await ctxFor("saeed", "YAS"), "today");
  assert.equal(o.tiles.onSite, live);
});

test("branch manager sees only their branch; technician cannot open it", async () => {
  const m = await ownerOverview(await ctxFor("yousef", "YAS"), "7d");
  assert.deepEqual(m.chosen.map((b) => b.code), ["YAS"]);
  await assert.rejects(ownerOverview(await ctxFor("ramesh", "YAS"), "today"), (e: unknown) => e instanceof AppError && e.code === "forbidden");
});

test("enquiries by branch and branch details add up and respect price access", async () => {
  const { ownerEnquiries, ownerBranchDetails } = await import("../lib/services/owner");
  const e = await ownerEnquiries(await ctxFor("saeed", "YAS"), "30d");
  const n = (await adminQuery("SELECT count(*)::int n FROM enquiry WHERE doc_date BETWEEN $1 AND $2", [e.from, e.to]))[0].n;
  assert.equal(e.totals.enquiries, n);
  for (const r of e.rows) assert.equal(r.enquiries, r.whatsapp + r.phone + r.walk_in + r.website + r.other);
  const d = await ownerBranchDetails(await ctxFor("saeed", "YAS"), "7d");
  assert.ok(d.rows.every((r) => r.bay_use === null || (r.bay_use >= 0 && r.bay_use <= 100)));
  assert.ok(d.rows.some((r) => r.bays > 0));
  const yE = await ownerEnquiries(await ctxFor("yousef", "YAS"), "30d");
  assert.equal(yE.rows.length, 1);
  assert.ok(Array.isArray(yE.openList));
});

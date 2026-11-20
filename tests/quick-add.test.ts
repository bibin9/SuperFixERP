import "./env";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { resetTestDb, adminQuery } from "./helpers";
import { closePool } from "../lib/db";
import { ctxFor } from "../lib/ctx-helper";
import { quickSave, quickSpec, canQuickAdd } from "../lib/services/quick-add";
import { AppError } from "../lib/errors";

before(async () => { await resetTestDb(true); });
after(async () => { await closePool(); });

test("+ New from a picker: same rights and checks as the master screens; the new record comes back for the picker", async () => {
  const yousef = await ctxFor("yousef", "YAS"), admin = await ctxFor("admin", "YAS"), ramesh = await ctxFor("ramesh", "YAS");

  // Parts are kept by settings users: a branch manager gets no form and the server refuses the save.
  assert.equal(canQuickAdd(yousef, "items"), false);
  assert.equal(await quickSpec(yousef, "items"), null);
  await assert.rejects(quickSave(yousef, "items", { part_no: "QA-1", description: "x", category: "filters", uom: "EA", list_price: "1", vat_code: "SR", item_type: "stock" }),
    (e: unknown) => e instanceof AppError && e.code === "forbidden");
  assert.equal((await adminQuery("SELECT count(*)::int n FROM item WHERE part_no = 'QA-1'"))[0].n, 0);

  // The administrator adds a part; fields not on the short form cannot be smuggled in.
  const spec = await quickSpec(admin, "items");
  assert.ok(spec && spec.fields.some((f) => f.name === "list_price"));
  const cat = spec!.fields.find((f) => f.name === "category")!.options![0][0];
  const r = await quickSave(admin, "items", { part_no: "QA-2", description: "Quick filter", category: cat, uom: "EA", list_price: "12.50", vat_code: "SR", item_type: "stock", active: "false", preferred_supplier_id: "x" });
  assert.ok(r.ok && r.label === "QA-2 · Quick filter");
  const row = (await adminQuery("SELECT active, preferred_supplier_id FROM item WHERE part_no = 'QA-2'"))[0];
  assert.equal(row.active, true); assert.equal(row.preferred_supplier_id, null);
  assert.equal((await adminQuery("SELECT count(*)::int n FROM audit_log WHERE entity = 'master:item' AND action = 'create'"))[0].n >= 1, true);
  // Same rules as the master: a duplicate part number is refused.
  await assert.rejects(quickSave(admin, "items", { part_no: "QA-2", description: "again", category: cat, uom: "EA", list_price: "1", vat_code: "SR", item_type: "stock" }));

  // Customers and cars: front-office rights; a technician cannot add them.
  assert.equal(canQuickAdd(ramesh, "customer"), false);
  await assert.rejects(quickSave(ramesh, "customer", { customer_type: "individual", title: "MR", first_name: "A", last_name: "B", country_code: "AE", mobile: "0501112233", id_type: "Emirates ID", id_number: "1" }));
  const titles = (await adminQuery("SELECT code FROM customer_title WHERE active LIMIT 1"));
  const c = await quickSave(yousef, "customer", { customer_type: "individual", title: titles[0].code, first_name: "Quick", last_name: "Add", country_code: "AE", mobile: "0507654321", id_type: "Emirates ID", id_number: "784-1990-7654321-1" });
  assert.ok(c.ok, JSON.stringify(c));
  // A second customer with the same mobile comes back as a possible duplicate, not saved.
  const dup = await quickSave(yousef, "customer", { customer_type: "individual", title: titles[0].code, first_name: "Other", last_name: "Person", country_code: "AE", mobile: "0507654321", id_type: "Emirates ID", id_number: "784-1990-7654321-2" });
  assert.ok(!dup.ok && dup.dups?.length);
  // A car needs an owner and the same checks as the customer page (VIN or a reason).
  await assert.rejects(quickSave(yousef, "vehicle", { registered_in: "AUH", plate_code: "5", plate_number: "12399", make: "Kia", model: "Rio", model_year: "2020", vin_missing_reason: "none" }));
  await assert.rejects(quickSave(yousef, "vehicle", { owner_customer_id: c.ok ? c.id : "", registered_in: "AUH", plate_code: "5", plate_number: "12399", make: "Kia", model: "Rio", model_year: "2020" }));
  const v = await quickSave(yousef, "vehicle", { owner_customer_id: c.ok ? c.id : "", registered_in: "AUH", plate_code: "5", plate_number: "12399", make: "Kia", model: "Rio", model_year: "2020", vin_missing_reason: "Not on the card" });
  assert.ok(v.ok && /AUH 5 12399 · Kia Rio/.test(v.label), JSON.stringify(v));
});

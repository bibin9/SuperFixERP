import { test } from "node:test";
import assert from "node:assert/strict";
import { calcDocument, splitInclusive, newAverageCost } from "../lib/money";
import { discountPercents } from "../lib/services/quotations";

test("FSD 5.1 worked example: 60,000 km service with 10% document discount", () => {
  const r = calcDocument([
    { key: "labour", qty: "2.5", unitPrice: "180.00", lineDiscount: "0", vatRate: "0.05" },
    { key: "oil", qty: "5", unitPrice: "32.00", lineDiscount: "0", vatRate: "0.05" },
    { key: "filter", qty: "1", unitPrice: "45.00", lineDiscount: "0", vatRate: "0.05" },
    { key: "pads", qty: "1", unitPrice: "380.00", lineDiscount: "0", vatRate: "0.05" },
  ], "103.50");
  assert.deepEqual(r.lines.map((l) => [l.docDiscountShare.toFixed(2), l.taxable.toFixed(2), l.vat.toFixed(2)]), [
    ["45.00", "405.00", "20.25"], ["16.00", "144.00", "7.20"], ["4.50", "40.50", "2.03"], ["38.00", "342.00", "17.10"],
  ]);
  assert.equal(r.taxable.toFixed(2), "931.50");
  assert.equal(r.vat.toFixed(2), "46.58");
  assert.equal(r.total.toFixed(2), "978.08");
});

test("document discount spread: the last line absorbs the rounding remainder", () => {
  const r = calcDocument([
    { key: "a", qty: "1", unitPrice: "10.00", lineDiscount: "0", vatRate: "0.05" },
    { key: "b", qty: "1", unitPrice: "10.00", lineDiscount: "0", vatRate: "0.05" },
    { key: "c", qty: "1", unitPrice: "10.00", lineDiscount: "0", vatRate: "0.05" },
  ], "10.00");
  assert.deepEqual(r.lines.map((l) => l.docDiscountShare.toFixed(2)), ["3.33", "3.33", "3.34"]);
  assert.equal(r.taxable.toFixed(2), "20.00");
});

test("line discount larger than the line is refused", () => {
  assert.throws(() => calcDocument([{ key: "a", qty: "1", unitPrice: "10", lineDiscount: "10.01", vatRate: "0.05" }]));
});

test("VAT-inclusive counter price: AED 420.00 gives net 400.00 and VAT 20.00", () => {
  const r = splitInclusive("420.00", "0.05");
  assert.equal(r.net.toFixed(2), "400.00");
  assert.equal(r.vat.toFixed(2), "20.00");
});

test("weighted average cost: 10 at 40.00 plus 20 at 43.00 gives 42.00", () => {
  assert.equal(newAverageCost("10", "40.00", "20", "43.00").toFixed(2), "42.00");
  // UOM example: drum of 208 L for AED 1,664.00 is AED 8.00 a litre
  assert.equal(newAverageCost("0", "0", "208", (1664 / 208).toFixed(4)).toFixed(2), "8.00");
});

test("discount percent per line and per document", () => {
  const r = calcDocument([{ key: "a", qty: "1", unitPrice: "100", lineDiscount: "15", vatRate: "0.05" }, { key: "b", qty: "1", unitPrice: "100", lineDiscount: "0", vatRate: "0.05" }], "5");
  const p = discountPercents(r.lines, r.lines[0].docDiscountShare.plus(r.lines[1].docDiscountShare));
  assert.equal(p.maxLinePct.toFixed(2), "15.00");
  assert.equal(p.docPct.toFixed(2), "10.00");
});

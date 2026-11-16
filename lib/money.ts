import Decimal from "decimal.js";

// FSD 5: rounding to 2 decimals, half up, unless stated. Exact decimal arithmetic only.
Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_UP });
export { Decimal };
export type Num = Decimal.Value;
export const D = (v: Num | null | undefined) => new Decimal(v ?? 0);
export const r2 = (v: Num) => D(v).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
export const r3 = (v: Num) => D(v).toDecimalPlaces(3, Decimal.ROUND_HALF_UP);
export const r4 = (v: Num) => D(v).toDecimalPlaces(4, Decimal.ROUND_HALF_UP);
export const m2 = (v: Num) => r2(v).toFixed(2);
export const fmtAED = (v: Num | null | undefined) =>
  v === null || v === undefined ? "" : Number(r2(v).toFixed(2)).toLocaleString("en-AE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Parses user input as an exact decimal; never goes through binary floating point. */
export function parseDec(input: unknown, field: string, opts: { min?: Num; max?: Num; dp?: number } = {}): Decimal {
  const s = String(input ?? "").trim().replace(/,/g, "");
  if (!/^-?\d+(\.\d+)?$/.test(s)) throw new Error(`${field} must be a number`);
  const d = new Decimal(s);
  if (opts.dp !== undefined && d.decimalPlaces() > opts.dp) throw new Error(`${field} allows at most ${opts.dp} decimals`);
  if (opts.min !== undefined && d.lt(opts.min)) throw new Error(`${field} must be at least ${opts.min}`);
  if (opts.max !== undefined && d.gt(opts.max)) throw new Error(`${field} must be at most ${opts.max}`);
  return d;
}

export type CalcLineIn = { key: string; qty: Num; unitPrice: Num; lineDiscount: Num; vatRate: Num };
export type CalcLineOut = { key: string; gross: Decimal; lineDiscount: Decimal; docDiscountShare: Decimal; taxable: Decimal; vat: Decimal; total: Decimal };

/**
 * FSD 5.1 line VAT. Taxable = qty x unit price - line discount - share of the document discount
 * (spread in proportion to line amounts after line discounts; the last line takes the rounding
 * remainder). VAT = taxable x rate, rounded per line. Document VAT = sum of line VAT.
 */
export function calcDocument(lines: CalcLineIn[], docDiscount: Num = 0) {
  const pre = lines.map((l) => {
    const gross = r2(D(l.qty).mul(l.unitPrice));
    const ld = r2(l.lineDiscount);
    if (ld.gt(gross)) throw new Error("Line discount cannot exceed the line amount");
    return { l, gross, ld, net: gross.minus(ld) };
  });
  const netTotal = pre.reduce((s, p) => s.plus(p.net), D(0));
  const dd = r2(docDiscount);
  if (dd.gt(netTotal)) throw new Error("Document discount cannot exceed the total");
  let allocated = D(0);
  const lastIdx = (() => { for (let i = pre.length - 1; i >= 0; i--) if (pre[i].net.gt(0)) return i; return -1; })();
  const out: CalcLineOut[] = pre.map((p, i) => {
    let share = D(0);
    if (dd.gt(0) && p.net.gt(0)) {
      share = i === lastIdx ? dd.minus(allocated) : r2(dd.mul(p.net).div(netTotal));
      allocated = allocated.plus(share);
    }
    const taxable = p.net.minus(share);
    const vat = r2(taxable.mul(p.l.vatRate));
    return { key: p.l.key, gross: p.gross, lineDiscount: p.ld, docDiscountShare: share, taxable, vat, total: taxable.plus(vat) };
  });
  const sum = (f: (x: CalcLineOut) => Decimal) => out.reduce((s, x) => s.plus(f(x)), D(0));
  const taxable = sum((x) => x.taxable);
  const vat = sum((x) => x.vat);
  return {
    lines: out,
    gross: sum((x) => x.gross),
    discount: sum((x) => x.lineDiscount.plus(x.docDiscountShare)),
    taxable, vat, total: taxable.plus(vat),
  };
}

/** VAT-inclusive price (counter sales): net = gross / (1 + rate), VAT = gross - net. */
export function splitInclusive(gross: Num, rate: Num) {
  const net = r2(D(gross).div(D(1).plus(rate)));
  return { net, vat: r2(D(gross).minus(net)) };
}

/** Weighted average cost (IN-02). */
export function newAverageCost(onHand: Num, avg: Num, recvQty: Num, recvCost: Num) {
  const q = D(onHand).plus(recvQty);
  if (q.lte(0)) return D(recvCost);
  return r4(D(onHand).mul(avg).plus(D(recvQty).mul(recvCost)).div(q));
}

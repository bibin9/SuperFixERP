import { invalid } from "./errors";

export const str = (v: unknown) => (v === undefined || v === null ? "" : String(v).trim());
export const optStr = (v: unknown) => str(v) || null;

export function required(v: unknown, field: string) {
  const s = str(v);
  if (!s) throw invalid(`${field} is required.`);
  return s;
}

/** Normalises a mobile to international format using the Countries master (CV-02, FSD 3.8). */
export function normaliseMobile(input: unknown, country: { dial_code: string; mobile_regex: string; name: string }) {
  let s = str(input).replace(/[\s\-()]/g, "");
  if (s.startsWith("+")) s = s.slice(1);
  else if (s.startsWith("00")) s = s.slice(2);
  if (s.startsWith(country.dial_code)) s = s.slice(country.dial_code.length);
  if (s.startsWith("0")) s = s.slice(1);
  if (!new RegExp(country.mobile_regex).test(s)) throw invalid(`Mobile number is not valid for ${country.name}.`);
  return `+${country.dial_code}${s}`;
}

/** VIN: 17 letters and digits, no I, O or Q (FSD 3.8). */
export function normaliseVin(input: unknown) {
  const v = str(input).toUpperCase().replace(/\s/g, "");
  if (!v) return null;
  if (!/^[A-HJ-NPR-Z0-9]{17}$/.test(v)) throw invalid("VIN must be 17 letters and digits, without I, O or Q.");
  return v;
}

export function normaliseTrn(input: unknown) {
  const v = str(input).replace(/[\s-]/g, "");
  if (!v) return null;
  if (!/^[0-9]{15}$/.test(v)) throw invalid("TRN must be 15 digits.");
  return v;
}

/** Emirates ID: 15 digits starting 784, shown 784-YYYY-NNNNNNN-C. */
export function normaliseEmiratesId(input: unknown) {
  const v = str(input).replace(/[\s-]/g, "");
  if (!/^784[0-9]{12}$/.test(v)) throw invalid("Emirates ID must be 15 digits starting with 784.");
  return `${v.slice(0, 3)}-${v.slice(3, 7)}-${v.slice(7, 14)}-${v.slice(14)}`;
}

export function int(v: unknown, field: string, min?: number, max?: number) {
  const s = str(v);
  if (!/^-?\d+$/.test(s)) throw invalid(`${field} must be a whole number.`);
  const n = Number(s);
  if ((min !== undefined && n < min) || (max !== undefined && n > max)) throw invalid(`${field} must be between ${min} and ${max}.`);
  return n;
}

export const optInt = (v: unknown, field: string, min?: number, max?: number) => (str(v) ? int(v, field, min, max) : null);

export function checkVersion(row: { version: number }, submitted: unknown) {
  if (submitted !== undefined && submitted !== null && str(submitted) !== "" && Number(submitted) !== row.version) {
    throw invalid("Someone else changed this record. Reload to see their change.");
  }
}

/**
 * One CSV cell, safe to open in a spreadsheet (SEC-03). Numbers stay numbers. Text that a spreadsheet
 * would read as a formula (starting with = + - @, a tab or a carriage return, after any spaces) gets a
 * leading apostrophe, so it shows as typed and never runs. Quotes, commas and line breaks are quoted.
 */
export function csvCell(v: unknown, alwaysQuote = false): string {
  let s = v === null || v === undefined ? "" : String(v);
  const numeric = typeof v === "number" || /^-?\d+(\.\d+)?$/.test(s.trim());
  if (!numeric && /^[\s]*[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return alwaysQuote || /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const csvRow = (cells: unknown[], alwaysQuote = false) => cells.map((c) => csvCell(c, alwaysQuote)).join(",");

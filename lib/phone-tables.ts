/**
 * Lists (tables with a header row of five or more columns and no form fields) show as one card per row on phones.
 * The card layout is pure CSS (globals.css), so it is already right in the server HTML. This adds each cell's
 * column name as data-label for the card. Tables of form fields (two or more columns) are labelled too, because
 * phones show each of their rows as a small form. It is plain browser code with no imports, because it is also sent
 * as an inline script that runs straight after the page content, before the page is first painted.
 */
export function markPhoneTables() {
  document.querySelectorAll(".main table").forEach(function (t) {
    var ths = Array.prototype.map.call(t.querySelectorAll("thead th"), function (th: Element) { return (th.textContent || "").trim(); }) as string[];
    var form = !!t.querySelector("tbody input:not([type=hidden]),tbody select,tbody textarea");
    if (ths.length < (form ? 2 : 5)) return;
    t.querySelectorAll("tbody tr").forEach(function (tr) {
      // A cell spanning several columns takes the first column's name; the next cell lines up after it.
      var col = 0;
      Array.prototype.forEach.call(tr.children, function (td: Element) {
        var i = col; col += (td as HTMLTableCellElement).colSpan || 1;
        if (ths[i] && td.getAttribute("data-label") !== ths[i]) td.setAttribute("data-label", ths[i]);
      });
    });
  });
}
export const PHONE_TABLES_INLINE = `(${markPhoneTables.toString()})()`;

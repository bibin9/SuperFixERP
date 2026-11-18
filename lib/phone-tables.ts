/**
 * Lists (tables with a header row of five or more columns and no form fields) show as one card per row on phones.
 * The card layout is pure CSS (globals.css), so it is already right in the server HTML. This adds each cell's
 * column name as data-label for the card. It is plain browser code with no imports, because it is also sent
 * as an inline script that runs straight after the page content, before the page is first painted.
 */
export function markPhoneTables() {
  document.querySelectorAll(".main table").forEach(function (t) {
    var ths = Array.prototype.map.call(t.querySelectorAll("thead th"), function (th: Element) { return (th.textContent || "").trim(); }) as string[];
    if (ths.length < 5 || t.querySelector("tbody input,tbody select,tbody textarea")) return;
    t.querySelectorAll("tbody tr").forEach(function (tr) {
      Array.prototype.forEach.call(tr.children, function (td: Element, i: number) {
        if (ths[i] && td.getAttribute("data-label") !== ths[i]) td.setAttribute("data-label", ths[i]);
      });
    });
  });
}
export const PHONE_TABLES_INLINE = `(${markPhoneTables.toString()})()`;

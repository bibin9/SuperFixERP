// The suites drive forms as they were written before sub-tasks moved into popups (20 Nov 2026): this shows
// every popup's form in place on the page so the same selectors work (the
// buttons that open them come after the form in the page, so a search for the save button finds the form's).
// The popups themselves (open, save, close, refused save) are checked by tests/uat/popups.mjs.
export const inlinePopups = () => {
  const css = "dialog.popup:not([open]){display:block!important;position:static!important;width:auto!important;max-height:none!important;box-shadow:none!important;margin:8px 0!important;border:1px dashed #ccc!important}"
    + " dialog.popup .popup-head{display:none!important}";
  const add = () => { if (document.getElementById("t-inline-popups")) return; const s = document.createElement("style"); s.id = "t-inline-popups"; s.textContent = css; (document.head || document.documentElement).appendChild(s); };
  document.addEventListener("DOMContentLoaded", add); add();
};

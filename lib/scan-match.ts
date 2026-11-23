/**
 * IN-07 / UX-03: find a part by what a scanner or a person typed. `codes` is item.search_codes: the part
 * number, barcode, OEM number and other part numbers, upper case and separated by |. An exact code wins,
 * then the same code ignoring spaces, dots and dashes, then a code that starts with what was typed. Each
 * step only picks a part when exactly one part matches.
 */
export function matchCode<T extends { codes?: string | null; part_no?: string }>(raw: string, list: T[]): T | null {
  const code = raw.trim().toUpperCase().replace(/\s+/g, " ");
  if (!code) return null;
  const squash = (s: string) => s.replace(/[\s.\-]/g, "");
  const entries = (x: T) => {
    const e = (x.codes ?? x.part_no ?? "").toUpperCase().split("|").map((s) => s.trim().replace(/\s+/g, " ")).filter(Boolean);
    // "MANN C 26003" can also be found as "C 26003" or "C26003": the words after a brand count too.
    return [...e, ...e.filter((s) => s.includes(" ")).map((s) => s.slice(s.indexOf(" ") + 1))];
  };
  const pick = (test: (e: string) => boolean) => {
    const hits = list.filter((x) => entries(x).some(test));
    return hits.length === 1 ? hits[0] : null;
  };
  return pick((e) => e === code) ?? pick((e) => squash(e) === squash(code)) ?? pick((e) => e.startsWith(code) || squash(e).startsWith(squash(code)));
}

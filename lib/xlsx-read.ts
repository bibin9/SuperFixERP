import { inflateRawSync } from "node:zlib";

/**
 * Reads the first sheet of an Excel .xlsx file into CSV text, so an import can take the file as it is
 * saved from Excel. Plain zip and XML reading only: no formulas are run, and cells keep the value
 * Excel last saved. Dates come through as Excel day numbers; the import turns those into dates.
 */
export function xlsxToCsv(buf: Buffer): string {
  const files = unzip(buf);
  const shared = files["xl/sharedStrings.xml"] ? [...files["xl/sharedStrings.xml"].matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => text(m[1])) : [];
  const sheetName = Object.keys(files).filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n)).sort((a, b) => num(a) - num(b))[0];
  if (!sheetName) throw new Error("This Excel file has no sheet.");
  const out: string[][] = [];
  for (const row of files[sheetName].matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells: string[] = [];
    for (const c of row[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const ref = /r="([A-Z]+)\d+"/.exec(c[1])?.[1]; const t = /t="(\w+)"/.exec(c[1])?.[1];
      const body = c[2] ?? "";
      let v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? "";
      if (t === "s") v = shared[Number(v)] ?? ""; else if (t === "inlineStr") v = text(body); else v = unxml(v);
      const at = ref ? colIndex(ref) : cells.length;
      while (cells.length < at) cells.push("");
      cells[at] = v;
    }
    out.push(cells);
  }
  return out.filter((r) => r.some((x) => x.trim())).map((r) => r.map(csvCell).join(",")).join("\n");
}

const num = (n: string) => Number(/(\d+)\.xml$/.exec(n)?.[1] ?? 0);
const colIndex = (ref: string) => [...ref].reduce((a, ch) => a * 26 + ch.charCodeAt(0) - 64, 0) - 1;
const unxml = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d))).replace(/&amp;/g, "&");
const text = (xml: string) => unxml([...xml.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((m) => m[1]).join(""));
const csvCell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

/** The zip entries this reader needs (stored or deflated), by name. */
function unzip(buf: Buffer): Record<string, string> {
  let end = buf.length - 22;
  while (end >= 0 && buf.readUInt32LE(end) !== 0x06054b50) end--;
  if (end < 0) throw new Error("This is not an Excel .xlsx file. Save it as .xlsx or CSV and try again.");
  const count = buf.readUInt16LE(end + 10); let p = buf.readUInt32LE(end + 16);
  const out: Record<string, string> = {};
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10), size = buf.readUInt32LE(p + 20), nameLen = buf.readUInt16LE(p + 28), extra = buf.readUInt16LE(p + 30), comment = buf.readUInt16LE(p + 32), local = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extra + comment;
    if (!/^xl\/(sharedStrings|worksheets\/sheet\d+)\.xml$/.test(name)) continue;
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const data = buf.subarray(start, start + size);
    const raw = method === 0 ? data : method === 8 ? inflateRawSync(data, { maxOutputLength: 50_000_000 }) : null;
    if (raw) out[name] = raw.toString("utf8");
  }
  return out;
}

import { requireCtx } from "@/lib/session";
import { globalSearch } from "@/lib/services/search";
import { Link, PageHead } from "@/components/ui";

export default async function Search({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const ctx = await requireCtx();
  const q = (await searchParams).q ?? "";
  const rows = await globalSearch(ctx, q);
  const groups = [...new Set(rows.map((r) => r.type))];
  return (
    <>
      <PageHead title={`Search: ${q}`} sub="Customers and vehicles from all branches; documents from your branches." />
      {!rows.length && <div className="card muted">Nothing found. Try part of a plate, 6+ digits of a mobile, the last 6 of a VIN, or a job number.</div>}
      {groups.map((g) => (
        <div className="card" key={g}><h2>{g}</h2>
          <table><tbody>{rows.filter((r) => r.type === g).map((r) => <tr key={r.href + r.label}><td><Link href={r.href}>{r.label}</Link></td><td className="muted">{r.sub}</td></tr>)}</tbody></table>
        </div>
      ))}
    </>
  );
}

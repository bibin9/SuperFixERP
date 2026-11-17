import { requireCtx } from "@/lib/session";
import { forbidden } from "@/lib/errors";
import { visibleReports, visibleLinks, REPORT_AREAS } from "@/lib/services/reports";
import { listSaved } from "@/lib/services/report-saved";
import { canAnywhere } from "@/lib/access";
import { Flash, Link, PageHead } from "@/components/ui";

export default async function AllReports({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const ctx = await requireCtx();
  const sp = await searchParams;
  const std = visibleReports(ctx), links = visibleLinks(ctx);
  if (!std.length && !links.length) throw forbidden();
  const mine = await listSaved(ctx);
  return (
    <>
      <PageHead title="All reports" sub="Standard reports, the Tally reports, and reports you saved or that were shared with you. Each one shows only your branches and the fields you may see.">
        {canAnywhere(ctx, "reports", "view") && <Link className="btn" href="/reports/builder">New report</Link>}
      </PageHead>
      <Flash sp={sp} />
      {mine.length > 0 && (
        <div className="card" style={{ marginBottom: 14 }} data-testid="saved-list"><h2>Saved and shared reports</h2>
          <table><tbody>{mine.map((r) => <tr key={r.id}><td><Link href={`/reports/saved/${r.id}`}>{r.name}</Link></td><td className="small muted">{r.kind === "copy" ? "Copy of a standard report" : "Built report"}</td>
            <td className="small">{r.mine ? (r.shared ? "Yours, shared" : "Yours, private") : `Shared by ${r.owner}`}</td></tr>)}</tbody></table>
        </div>)}
      <div className="rgrid" data-testid="report-index">
        {REPORT_AREAS.map((a) => {
          const rs = std.filter((r) => r.area === a), ls = links.filter((l) => l.area === a);
          if (!rs.length && !ls.length) return null;
          return (
            <div className="card" key={a}><h3>{a}</h3><ul>
              {rs.map((r) => <li key={r.code}><Link href={`/reports/run/${r.code}`}>{r.name}</Link>{r.trace && <span className="small muted"> · {r.trace}</span>}</li>)}
              {ls.map((l) => <li key={l.name}><Link href={l.href}>{l.name}</Link> <span className="small muted">· in Accounting</span></li>)}
            </ul></div>
          );
        })}
      </div>
    </>
  );
}

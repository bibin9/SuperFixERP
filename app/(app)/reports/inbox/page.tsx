import { requireCtx } from "@/lib/session";
import { inbox } from "@/lib/services/report-saved";
import { visibleReports } from "@/lib/services/reports";
import { forbidden } from "@/lib/errors";
import { Flash, Link, PageHead, dt, d } from "@/components/ui";
import { stopScheduleAction, prepareNowAction } from "@/app/actions-reports";

const FREQ: Record<string, string> = { daily: "Daily", weekly: "Weekly", monthly: "Monthly" };

export default async function Inbox({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const ctx = await requireCtx();
  const sp = await searchParams;
  if (!visibleReports(ctx).length) throw forbidden();
  const ib = await inbox(ctx);
  return (
    <>
      <PageHead title="Report inbox" sub="Reports you scheduled are prepared here as Excel files when they fall due. Download one and email it yourself if you want to share it; nothing is sent automatically." >
        <Link className="btn ghost sm" href="/reports/all">All reports</Link>
      </PageHead>
      <Flash sp={sp} />
      {ib.prepared > 0 && <div className="flash ok">{ib.prepared} scheduled report(s) were prepared just now.</div>}
      <div className="card" data-testid="inbox">
        <h2>Prepared files</h2>
        <table><thead><tr><th>Report</th><th>Period</th><th className="num">Rows</th><th>Prepared</th><th><span className="vh">Actions</span></th></tr></thead><tbody>
          {ib.items.map((i) => <tr key={i.id}><td>{i.opened_at ? i.title : <b>{i.title}</b>}</td><td>{i.period_label}</td><td className="num">{i.row_count}</td><td className="small">{dt(i.prepared_at)}</td>
            <td><a className="btn ghost sm" href={`/api/reports/inbox/${i.id}`} data-testid="inbox-download">Download Excel</a></td></tr>)}
          {!ib.items.length && <tr><td colSpan={5} className="muted">Nothing prepared yet.</td></tr>}
        </tbody></table>
      </div>
      <div className="card" style={{ marginTop: 16 }} data-testid="schedules">
        <h2>My schedules</h2>
        <table><thead><tr><th>Report</th><th>How often</th><th>Next due</th><th><span className="vh">Actions</span></th></tr></thead><tbody>
          {ib.schedules.map((s) => <tr key={s.id}><td><Link href={s.report_ref.startsWith("std:") ? `/reports/run/${s.report_ref.slice(4)}` : `/reports/saved/${s.report_ref.slice(4)}`}>{s.title}</Link></td>
            <td>{FREQ[s.frequency]}</td><td>{d(s.next_due)}</td>
            <td className="row" style={{ gap: 6 }}>
              <form action={prepareNowAction} className="shrink"><input type="hidden" name="id" value={s.id} /><button className="btn ghost sm" data-testid="prepare-now">Prepare now</button></form>
              <form action={stopScheduleAction} className="shrink"><input type="hidden" name="id" value={s.id} /><button className="btn ghost red-text sm">Stop</button></form></td></tr>)}
          {!ib.schedules.length && <tr><td colSpan={4} className="muted">No schedules. Open a report and use “Prepare on a schedule”.</td></tr>}
        </tbody></table>
      </div>
    </>
  );
}

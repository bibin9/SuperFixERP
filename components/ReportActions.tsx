import { pinReportAction, scheduleReportAction } from "@/app/actions-reports";

/** Pin a report to the reports dashboard, or have it prepared on a schedule into the report inbox (RB-07, RB-10). */
export function ReportActions({ refId, title, back, defaults, chart, canExport }: { refId: string; title: string; back: string; defaults: Record<string, string>; chart?: string | null; canExport: boolean }) {
  const hidden = Object.entries(defaults).filter(([k, v]) => v && !["from", "to"].includes(k)).map(([k, v]) => <input key={k} type="hidden" name={`d_${k}`} value={v} />);
  return (
    <div className="grid2 no-print" style={{ marginTop: 16 }}>
      <details className="card" data-testid="pin-box"><summary><b>Pin to my reports dashboard</b></summary>
        <form action={pinReportAction} className="row" style={{ alignItems: "flex-end", marginTop: 10 }}>
          <input type="hidden" name="ref" value={refId} /><input type="hidden" name="$back" value={back} />
          <div className="field"><label htmlFor="pin_title">Title</label><input id="pin_title" name="title" defaultValue={title} maxLength={120} /></div>
          <div className="field"><label htmlFor="pin_chart">Show as</label><select id="pin_chart" name="chart" defaultValue={chart ?? "table"}><option value="table">Table</option><option value="bar">Bar chart</option><option value="line">Line chart</option><option value="pie">Pie chart</option></select></div>
          <div className="shrink"><button className="btn">Pin</button></div>
        </form>
      </details>
      <details className="card" data-testid="schedule-box"><summary><b>Prepare on a schedule</b></summary>
        {canExport ? (
          <form action={scheduleReportAction} className="row" style={{ alignItems: "flex-end", marginTop: 10 }}>
            <input type="hidden" name="ref" value={refId} /><input type="hidden" name="$back" value={back} />{hidden}
            <div className="field"><label htmlFor="sch_freq">How often</label><select id="sch_freq" name="frequency" defaultValue="weekly"><option value="daily">Daily (yesterday)</option><option value="weekly">Weekly (last 7 days)</option><option value="monthly">Monthly (last month)</option></select></div>
            <div className="shrink"><button className="btn">Schedule</button></div>
            <p className="small muted" style={{ flexBasis: "100%" }}>The Excel file is prepared into your report inbox with the filters shown now. Download it there and email it yourself; nothing is sent automatically.</p>
          </form>
        ) : <p className="small muted">Scheduled reports are Excel files, so they need the export permission for these branches.</p>}
      </details>
    </div>
  );
}

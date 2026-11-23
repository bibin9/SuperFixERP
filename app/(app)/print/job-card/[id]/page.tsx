import { requireCtx } from "@/lib/session";
import { jobCardPrint } from "@/lib/services/print";
import { displayName } from "@/lib/services/customers";
import { Bi, BiText, PrintHead, PrintPage, PrintSign, PrintTerms } from "@/components/PrintDoc";
import { PrintButton } from "@/components/PrintButton";
import { Link, d, dt } from "@/components/ui";
import { D } from "@/lib/money";

const day = (v: unknown) => d(typeof v === "string" ? v : (v as Date | null)?.toISOString?.().slice(0, 10));

/** OT-08: the job card as printed for the workshop and the customer, in English, Arabic or both. */
export default async function JobCardPrint({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireCtx();
  const { id } = await params;
  const { job: j, lines, names, setup: s } = await jobCardPrint(ctx, id);
  const L = s.lang;
  return (
    <>
      <div className="no-print row" style={{ marginBottom: 10 }}><PrintButton label="Print or save as PDF" /><Link className="btn ghost shrink" href={`/jobs/${id}`}>Back to the job card</Link></div>
      <PrintPage lang={L}>
        <PrintHead s={s} title="jobCard" meta={<>
          <div><b>{j.doc_no}</b></div>
          <div className="small"><Bi k="date" lang={L} inline /> {day(j.doc_date)}</div>
        </>} />
        <div className="printgrid">
          <div><span className="k"><Bi k="customer" lang={L} /></span><span>{displayName(j)}{j.customer_name_ar && L !== "en" && <div dir="rtl" lang="ar">{j.customer_name_ar}</div>}</span></div>
          <div><span className="k"><Bi k="mobile" lang={L} /></span><span>{j.mobile}</span></div>
          <div><span className="k"><Bi k="vehicle" lang={L} /></span><span>{j.make} {j.model} {j.model_year ?? ""}</span></div>
          <div><span className="k"><Bi k="plate" lang={L} /></span><span>{j.registered_in} {j.plate_code} {j.plate_number}</span></div>
          <div><span className="k"><Bi k="vin" lang={L} /></span><span>{j.vin ?? "—"}</span></div>
          <div><span className="k"><Bi k="odometer" lang={L} /></span><span>{j.odometer_in?.toLocaleString() ?? "—"}</span></div>
          <div><span className="k"><Bi k="fuel" lang={L} /></span><span>{j.fuel_level ?? "—"}/8</span></div>
          <div><span className="k"><Bi k="advisor" lang={L} /></span><span>{j.advisor_name ?? "—"}</span></div>
          {j.promised_at && <div><span className="k"><Bi k="promised" lang={L} /></span><span>{dt(j.promised_at)}</span></div>}
          {j.lpo_no && <div><span className="k"><Bi k="lpo" lang={L} /></span><span>{j.lpo_no}</span></div>}
        </div>
        {j.complaints && <><h3 style={{ marginTop: 12 }}><Bi k="complaints" lang={L} inline /></h3><p style={{ whiteSpace: "pre-wrap", margin: 0 }}>{j.complaints}</p></>}
        <h3 style={{ marginTop: 12 }}><Bi k="work" lang={L} inline /></h3>
        <table>
          <thead><tr><th><Bi k="lineNo" lang={L} /></th><th><Bi k="description" lang={L} /></th><th className="num"><Bi k="qty" lang={L} /></th></tr></thead>
          <tbody>{lines.map((l) => (
            <tr key={l.id}><td>{l.line_no}</td><td><BiText en={l.description} ar={names[l.id]} lang={L} /><div className="small muted"><Bi k={l.line_type === "labour" ? "labour" : "part"} lang={L} inline />{l.part_no ? ` · ${l.part_no}` : ""}</div></td><td className="num">{D(l.qty).toString()}</td></tr>
          ))}</tbody>
        </table>
        {j.valuables && <p className="small" style={{ marginTop: 8 }}><b><Bi k="valuables" lang={L} inline />:</b> {j.valuables}</p>}
        <PrintTerms s={s} />
        <PrintSign lang={L} leftImage={j.checkin_signature} right="advisor" />
      </PrintPage>
    </>
  );
}

import { requireCtx } from "@/lib/session";
import { dashboard, myDay } from "@/lib/services/home";
import { Icon } from "@/components/Icon";
import { custName } from "@/components/ui";
import { whatsappAction } from "@/app/actions";
import { canSee, roleAt, can } from "@/lib/access";
import { Link, Money, Status, dt, PageHead } from "@/components/ui";
import { STATUS_LABEL } from "@/lib/services/jobs";

export default async function Home({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const ctx = await requireCtx();
  const sp = await searchParams;
  const scope = ctx.allBranches && sp.scope !== "current" ? "all" : "current";
  const [d, m] = await Promise.all([dashboard(ctx, scope), myDay(ctx, scope)]);
  const front = can(ctx, "customers", "view") || can(ctx, "jobs", "view");
  const things = m.callBack.length + m.waiting.length + m.toCreate.length + m.ready.length + m.late.length;
  const hour = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hour12: false, timeZone: "Asia/Dubai" }).format(new Date()));
  const hello = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const role = roleAt(ctx, null);
  const total = d.byStatus.reduce((s, r) => s + Number(r.n), 0);
  return (
    <>
      <PageHead title={`${hello}, ${ctx.fullName.split(" ")[0]}`} sub={front ? `${scope === "all" ? "All branches" : "Your branch"} · ${things} thing${things === 1 ? "" : "s"} need you today. Start from the top.` : `${role?.roleName} · ${scope === "all" ? "all branches" : "current branch"}`}>
        {ctx.allBranches && <Link className="btn ghost sm" href={scope === "all" ? "/?scope=current" : "/"}>{scope === "all" ? "Current branch only" : "All branches"}</Link>}
        {can(ctx, "customers", "create") && <Link className="btn" href="/enquiries/new">New enquiry</Link>}
      </PageHead>
      {front && <>
        <form className="bigsearch" action="/search" role="search">
          <Icon name="search" size={20} className="sicon" />
          <input type="search" name="q" placeholder="Find a customer or car: plate, mobile, name or job card number" aria-label="Find a customer or car" />
        </form>
        {can(ctx, "customers", "create") && (
          <div className="quick">
            <Link href="/enquiries/new" className="card qa"><span className="qi red"><Icon name="chat" /></span><b>Customer is asking</b><span>A call, WhatsApp or walk-in question. Save it so nobody forgets to reply.</span></Link>
            <Link href="/enquiries/new?arrived=1" className="card qa"><span className="qi blue"><Icon name="car" /></span><b>A car has arrived</b><span>Customer, vehicle and check-in, then the quotation and the job card.</span></Link>
            <Link href="/bookings" className="card qa"><span className="qi teal"><Icon name="cal" /></span><b>Book a time</b><span>See free bays and give the customer a slot.</span></Link>
            {can(ctx, "invoices", "view") && <Link href="/invoices" className="card qa"><span className="qi green"><Icon name="cash" /></span><b>Take payment</b><span>Collect money and hand over the car.</span></Link>}
          </div>
        )}
        <div className="needs-head"><h2>Needs you now</h2><span className="muted small">Each line has one button: the next thing to do</span></div>
        <div className="grid2 needs">
          {can(ctx, "customers", "view") && <Panel icon="phone" tone="red" title="Reply or call back" n={m.callBack.length} empty="No follow-ups due today.">
            {m.callBack.map((e) => <Row key={e.id} title={e.customer_id ? custName(e) : e.contact_name ?? e.doc_no} tag={e.customer_type === "company" ? "Company" : undefined}
              sub={<>{e.service_asked} · follow up <span style={e.overdue ? { color: "var(--late)" } : undefined}>{dt(e.follow_up_at)}</span></>}>
              <Link className="btn sm" href={`/enquiries/${e.id}`}>Open</Link></Row>)}
          </Panel>}
          {can(ctx, "customers", "view") && <Panel icon="chat" tone="violet" title="Waiting for customer OK" n={m.waiting.length} empty="No quotations waiting.">
            {m.waiting.map((q) => <Row key={q.id} title={<>{q.job_no ?? q.doc_no} · {custName(q)}</>} sub={<>{q.make} {q.model} {q.model_year ?? ""} · quotation sent {dt(q.sent_at)}, no answer yet</>}>
              <Link className="btn sm" href={q.job_id ? `/jobs/${q.job_id}` : `/enquiries/${q.enquiry_id}`}>Open</Link></Row>)}
          </Panel>}
          {m.toCreate.length > 0 && <Panel icon="job" tone="blue" title="Approved, create the job card" n={m.toCreate.length} empty="">
            {m.toCreate.map((e) => <Row key={e.id} title={<>{e.doc_no} · {custName(e)}</>} sub={<>{e.make} {e.model} · {e.service_asked}</>}>
              <Link className="btn sm" href={`/enquiries/${e.id}`}>Create job card</Link></Row>)}
          </Panel>}
          {can(ctx, "jobs", "view") && <Panel icon="check" tone="green" title="Ready for the customer" n={m.ready.length} empty="No cars waiting for collection.">
            {m.ready.map((j) => <Row key={j.id} title={<>{j.doc_no} · {custName(j)}</>} sub={<>{j.make} {j.model} {j.model_year ?? ""} · {j.invoiced ? "invoiced, hand over the car" : "tell the customer and make the invoice"}</>}>
              {can(ctx, "jobs", "edit") && <form action={whatsappAction}><input type="hidden" name="job_id" value={j.id} /><input type="hidden" name="event" value="car_ready" /><input type="hidden" name="$back" value={`/jobs/${j.id}`} /><button className="btn sm ghost">Car ready</button></form>}
              <Link className="btn sm" href={j.invoiced ? `/jobs/${j.id}` : `/jobs/${j.id}/invoice`}>{j.invoiced ? "Deliver" : "Invoice"}</Link></Row>)}
          </Panel>}
          {can(ctx, "jobs", "view") && <Panel icon="alert" tone="red" title="Running late, tell the customer" n={m.late.length} empty="Nothing late.">
            {m.late.map((j) => <Row key={j.id} title={<>{j.doc_no} · {custName(j)}</>} sub={<>Promised {dt(j.promised_at)} · <Status s={j.status} /></>}>
              <Link className="btn sm" href={`/jobs/${j.id}#newtime`}>Send new time</Link></Row>)}
          </Panel>}
        </div>
        <h2 style={{ margin: "22px 0 12px" }}>Today at a glance</h2>
      </>}
      <div className="grid4">
        <div className="kpi"><div className="v">{total}</div><div className="l">Cars on site</div></div>
        <div className="kpi"><div className="v" style={{ color: d.late.length ? "var(--late)" : undefined }}>{d.late.length}</div><div className="l">Late jobs</div></div>
        <div className="kpi"><div className="v">{d.enq.open}</div><div className="l">Enquiries to quote ({d.enq.overdue} past follow-up)</div></div>
        <div className="kpi"><div className="v">{canSee(ctx, "selling_price") ? <Money v={d.sales.net} /> : "—"}</div><div className="l">Sales today, AED (net of VAT)</div></div>
      </div>
      <div className="grid2" style={{ marginTop: 16 }}>
        <div className="card">
          <h2>Quotations</h2>
          <table><tbody>
            <tr><td><Link href="/enquiries?status=quoted">Sent, waiting for the customer</Link></td><td className="num">{d.enq.quoted}</td></tr>
            <tr><td><Link href="/enquiries?status=approved">Approved, job card to create</Link></td><td className="num"><b>{d.enq.approved}</b></td></tr>
          </tbody></table>
        </div>
        <div className="card"><h2>How work starts</h2>
          <p className="small">Enquiry, then quotation, then the customer&apos;s approval, then the job card. A job card can only be created from an approved quotation.</p>
        </div>
      </div>
      <div className="grid2" style={{ marginTop: 16 }}>
        <div className="card">
          <h2>Jobs by status</h2>
          <table><tbody>
            {d.byStatus.map((r) => <tr key={r.status}><td><Link href={`/jobs?status=${r.status}`}>{STATUS_LABEL[r.status] ?? r.status}</Link></td><td className="num">{r.n}</td></tr>)}
            {!d.byStatus.length && <tr><td className="muted">No open jobs.</td></tr>}
          </tbody></table>
        </div>
        <div className="card">
          <h2>Late jobs</h2>
          <table><tbody>
            {d.late.map((j) => <tr key={j.id}><td><Link href={`/jobs/${j.id}`}>{j.doc_no}</Link></td><td><Status s={j.status} /></td><td className="small muted">promised {dt(j.promised_at)}</td></tr>)}
            {!d.late.length && <tr><td className="muted">Nothing late.</td></tr>}
          </tbody></table>
        </div>
      </div>
    </>
  );
}

function Panel({ icon, tone, title, n, empty, children }: { icon: string; tone: string; title: string; n: number; empty: string; children: React.ReactNode }) {
  return (
    <div className="card npanel">
      <div className="np-head"><span className={`qi sm ${tone}`}><Icon name={icon} size={18} /></span><b>{title}</b><span className={`np-n ${n ? tone : ""}`}>{n}</span></div>
      {n ? children : <p className="muted small np-empty">{empty}</p>}
    </div>
  );
}

function Row({ title, sub, tag, children }: { title: React.ReactNode; sub: React.ReactNode; tag?: string; children: React.ReactNode }) {
  return (
    <div className="np-row">
      <div className="np-txt"><b>{title}</b>{tag && <span className="pill blue">{tag}</span>}<div className="muted small">{sub}</div></div>
      <div className="np-act">{children}</div>
    </div>
  );
}

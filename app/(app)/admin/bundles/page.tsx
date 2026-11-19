import { requireCtx } from "@/lib/session";
import { listBundles } from "@/lib/services/bundles";
import { masters } from "@/lib/services/masters";
import { saveBundleAction } from "@/app/actions";
import { canAnywhere } from "@/lib/access";
import { forbidden } from "@/lib/errors";
import { Flash, Link, Money, PageHead } from "@/components/ui";
import { D } from "@/lib/money";

const BLANK = 4;

export default async function Bundles({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const ctx = await requireCtx();
  if (!canAnywhere(ctx, "settings", "view")) throw forbidden();
  const sp = await searchParams;
  const edit = canAnywhere(ctx, "settings", "edit");
  const [bundles, m] = await Promise.all([listBundles(ctx, { all: true }), masters(ctx)]);
  const cur = sp.id ? bundles.find((b) => b.id === sp.id) : null;
  const showForm = edit && (cur || sp.new);
  const rows = [...(cur?.lines ?? []).map((l) => ({ kind: l.service_id ? "labour" : "part", ref: l.service_id ?? l.item_id, qty: D(l.qty).toString() })),
    ...Array.from({ length: BLANK }, () => ({ kind: "", ref: "", qty: "1" }))];
  return (
    <>
      <PageHead title="Service bundles" sub="A whole service, every labour line and part, added to a quotation in one tap. Prices come from the service and part masters.">
        {edit && <Link className="btn" href="/admin/bundles?new=1">New bundle</Link>}
      </PageHead>
      <Flash sp={sp} />
      {showForm && (
        <form action={saveBundleAction} className="card">
          <h2>{cur ? `Change ${cur.name_en}` : "New bundle"}</h2>
          {cur && <><input type="hidden" name="id" value={cur.id} /><input type="hidden" name="version" value={cur.version} /></>}
          <div className="grid2">
            <div className="field"><label>Code</label><input name="code" required defaultValue={cur?.code} placeholder="e.g. B-10K-TOY" /></div>
            <div className="field"><label>Name</label><input name="name_en" required defaultValue={cur?.name_en} placeholder="10,000 km service, Toyota" /></div>
            <div className="field"><label>Name in Arabic</label><input name="name_ar" dir="rtl" defaultValue={cur?.name_ar ?? ""} /></div>
            <div className="field"><label>For vehicles (make, model or size)</label><input name="for_vehicles" defaultValue={cur?.for_vehicles ?? ""} placeholder="Toyota Land Cruiser" /></div>
            <div className="field"><label>Status</label><select name="active" defaultValue={cur && !cur.active ? "0" : "1"}><option value="1">Active</option><option value="0">Not used any more</option></select></div>
          </div>
          <h3>Lines</h3>
          <p className="small muted">For labour, Qty is how many times the service is done (for example 4 tyres fitted). Leave a line empty to drop it.</p>
          <table>
            <thead><tr><th>#</th><th>Labour or part</th><th>Service or part</th><th className="num">Qty</th></tr></thead>
            <tbody>{rows.map((r, i) => (
              <tr key={i}><td>{i + 1}</td>
                <td><select name="l_kind" defaultValue={r.kind || "part"} aria-label={`Line ${i + 1} type`}><option value="labour">Labour</option><option value="part">Part</option></select></td>
                <td><select name="l_ref" defaultValue={r.ref} aria-label={`Line ${i + 1} service or part`}><option value="">—</option>
                  <optgroup label="Labour">{m.services.map((s) => <option key={s.id} value={s.id}>{s.name_en}</option>)}</optgroup>
                  <optgroup label="Parts">{m.items.map((p) => <option key={p.id} value={p.id}>{p.part_no} · {p.description}</option>)}</optgroup></select></td>
                <td className="num"><input name="l_qty" defaultValue={r.qty} inputMode="decimal" style={{ width: 90 }} aria-label={`Line ${i + 1} quantity`} /></td></tr>
            ))}</tbody>
          </table>
          <div className="row" style={{ marginTop: 12 }}><button className="btn">Save bundle</button><Link className="btn ghost" href="/admin/bundles">Cancel</Link></div>
        </form>
      )}
      <div className="card">
        <table>
          <thead><tr><th>Bundle</th><th>For vehicles</th><th>Labour</th><th>Parts</th><th className="num">Price today</th><th>Status</th><th><span className="vh">Actions</span></th></tr></thead>
          <tbody>{bundles.map((b) => (
            <tr key={b.id}><td><b>{b.name_en}</b><div className="small muted">{b.code}</div></td><td>{b.for_vehicles ?? "—"}</td>
              <td className="small">{b.lines.filter((l) => l.service_id).map((l) => <div key={l.id}>{l.service_name}{D(l.qty).gt(1) ? ` × ${D(l.qty).toString()}` : ""}</div>)}</td>
              <td className="small">{b.lines.filter((l) => l.item_id).map((l) => <div key={l.id}>{D(l.qty).toString()} × {l.part_no}</div>)}</td>
              <td className="num"><Money v={b.price} /></td><td>{b.active ? <span className="pill green">Active</span> : <span className="pill">Not used</span>}</td>
              <td>{edit && <Link className="btn ghost sm" href={`/admin/bundles?id=${b.id}`}>Change</Link>}</td></tr>
          ))}
          {!bundles.length && <tr><td colSpan={7} className="muted">No bundles yet.</td></tr>}</tbody>
        </table>
      </div>
    </>
  );
}

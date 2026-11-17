import { requireCtx } from "@/lib/session";
import { listBranches } from "@/lib/services/admin";
import { saveBranchAction, branchActiveAction } from "@/app/actions";
import { ConfirmButton } from "@/components/ConfirmButton";
import { Flash, PageHead, label } from "@/components/ui";

const EMIRATES = ["Abu Dhabi", "Dubai", "Sharjah", "Ajman", "Umm Al Quwain", "Ras Al Khaimah", "Fujairah"];

export default async function Branches({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const ctx = await requireCtx();
  const sp = await searchParams;
  const rows = await listBranches(ctx);
  return (
    <>
      <PageHead title="Branches" sub="The branch code is the document prefix and cannot change once saved. A branch with open jobs, stock or staff cannot be deactivated." />
      <Flash sp={sp} />
      <div className="card"><h2>Add branch</h2>
        <form action={saveBranchAction} className="row">
          <div className="field"><label>Code</label><input name="code" required placeholder="ABC" /></div>
          <div className="field"><label>Name</label><input name="name_en" required /></div>
          <div className="field"><label>Name (Arabic)</label><input name="name_ar" dir="rtl" /></div>
          <div className="field"><label>Type</label><select name="branch_type"><option value="workshop">Workshop</option><option value="head_office">Head office</option><option value="warehouse">Warehouse</option></select></div>
          <div className="field"><label>Emirate</label><select name="emirate">{EMIRATES.map((e) => <option key={e}>{e}</option>)}</select></div>
          <div className="field"><label>WhatsApp number</label><input name="whatsapp_number" /></div>
          <div className="shrink"><button className="btn">Add</button></div>
        </form>
      </div>
      <div className="card">
        <table>
          <thead><tr><th>Code</th><th>Name</th><th>Type</th><th>Emirate</th><th>WhatsApp</th><th>Mode</th><th>Active</th><th></th></tr></thead>
          <tbody>{rows.map((b) => (
            <tr key={b.id}><td><b>{b.code}</b></td><td>{b.name_en}</td><td>{label(b.branch_type)}</td><td>{b.emirate}</td><td>{b.whatsapp_number}</td><td>{label(b.whatsapp_mode)}</td><td>{b.active ? "Yes" : "No"}</td>
              <td><form action={branchActiveAction}><input type="hidden" name="id" value={b.id} /><input type="hidden" name="active" value={String(!b.active)} /><ConfirmButton className="btn ghost sm" message={b.active ? `Deactivate branch ${b.code}?` : `Activate branch ${b.code}?`}>{b.active ? "Deactivate" : "Activate"}</ConfirmButton></form></td></tr>
          ))}</tbody>
        </table>
      </div>
    </>
  );
}

import { requireCtx } from "@/lib/session";
import { listSettings } from "@/lib/services/admin";
import { settingAction } from "@/app/actions";
import { Flash, PageHead } from "@/components/ui";

export default async function Settings({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const ctx = await requireCtx();
  const sp = await searchParams;
  const rows = await listSettings(ctx);
  const groups = [...new Set(rows.map((r) => r.grp))];
  return (
    <>
      <PageHead title="Settings" sub="Every threshold and switch lives here, never in code. Changes are logged with old and new values." />
      <Flash sp={sp} />
      {groups.map((g) => (
        <div className="card" key={g}><h2>{g}</h2>
          <table><tbody>{rows.filter((r) => r.grp === g).map((r) => (
            <tr key={r.id}><td style={{ width: "45%" }}><b>{r.description || r.key}</b>{r.branch_code && ` (${r.branch_code})`}<div className="small muted mono">{r.key}</div></td>
              <td><form action={settingAction} className="row"><input type="hidden" name="id" value={r.id} /><input name="value" defaultValue={typeof r.value === "string" ? r.value : JSON.stringify(r.value)} /><button className="btn ghost sm shrink">Save</button></form></td></tr>
          ))}</tbody></table>
        </div>
      ))}
    </>
  );
}

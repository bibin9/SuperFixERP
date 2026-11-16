import { requireCtx } from "@/lib/session";
import { MASTERS } from "@/lib/services/master-forms";
import { assertCan } from "@/lib/access";
import { Link, PageHead } from "@/components/ui";

export default async function Masters() {
  const ctx = await requireCtx();
  assertCan(ctx, "settings", "view");
  const groups = [...new Set(MASTERS.map((m) => m.group))];
  return (
    <>
      <PageHead title="Master forms" sub="Every list the system uses can be added to, edited and deactivated here. Changes are recorded in the audit log." />
      <div className="grid2">
        {groups.map((g) => (
          <div className="card" key={g}><h2>{g}</h2>
            <table><tbody>{MASTERS.filter((m) => m.group === g).map((m) => <tr key={m.key}><td><Link href={`/admin/masters/${m.key}`}>{m.title}</Link><div className="small muted">{m.note}</div></td></tr>)}</tbody></table>
          </div>
        ))}
        <div className="card"><h2>Also configurable</h2>
          <table><tbody>
            <tr><td><Link href="/admin/settings">Settings</Link><div className="small muted">Discount limits, minimum margin, quotation validity, sign-in rules, payroll and WPS defaults and other values.</div></td></tr>
            <tr><td><Link href="/admin/workflows">Approval workflows</Link><div className="small muted">Approvers, amount bands and backup approvers.</div></td></tr>
            <tr><td><Link href="/admin/numbering">Document numbering</Link></td></tr>
            <tr><td><Link href="/admin/branches">Branches</Link> · <Link href="/admin/users">Users</Link> · <Link href="/admin/roles">Roles and permissions</Link></td></tr>
          </tbody></table>
        </div>
      </div>
    </>
  );
}

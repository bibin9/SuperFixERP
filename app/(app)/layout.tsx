import Link from "next/link";
import { requireCtx } from "@/lib/session";
import { canAnywhere, roleAt } from "@/lib/access";
import { shellData } from "@/lib/services/home";
import { logoutAction, switchBranchAction } from "@/app/actions";
import { AutoSubmitSelect } from "@/components/AutoSubmit";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireCtx();
  const { branches, pending } = await shellData(ctx);
  const role = roleAt(ctx, ctx.currentBranchId);
  const can = (s: Parameters<typeof canAnywhere>[1], a: Parameters<typeof canAnywhere>[2] = "view") => canAnywhere(ctx, s, a);
  const menu: [string, [string, string, boolean, number?][]][] = [
    ["Front office", [
      ["/", "Home", true],
      ["/enquiries", "Enquiries", can("customers")],
      ["/customers", "Customers & vehicles", can("customers")],
      ["/jobs", "Job cards", can("jobs") || can("workshop")],
      ["/approvals", "Approvals", can("approvals"), pending],
    ]],
    ["Parts and billing", [
      ["/stock", "Stock", can("stock")],
      ["/invoices", "Invoices", can("invoices")],
      ["/accounts", "Trial balance", can("accounting")],
    ]],
    ["Administration", [
      ["/admin/branches", "Branches", can("admin")],
      ["/admin/users", "Users & access", can("admin")],
      ["/admin/roles", "Roles & permissions", can("admin")],
      ["/admin/workflows", "Approval workflows", can("settings")],
      ["/admin/numbering", "Document numbering", can("settings")],
      ["/admin/settings", "Settings", can("settings")],
      ["/admin/audit", "Audit log", can("admin")],
    ]],
  ];
  return (
    <div className="app">
      <aside className="side">
        <div className="brand"><div className="mk">A</div><div><b>AUTOVIQO</b><small>Smart Garage ERP</small></div></div>
        <div className="client">{/* eslint-disable-next-line @next/next/no-img-element */}<img src="/sflogo.png" alt="Superfix" /><span>Super Fix Auto Centers</span></div>
        <nav className="nav">
          {menu.map(([grp, items]) => {
            const shown = items.filter((i) => i[2]);
            if (!shown.length) return null;
            return (
              <div key={grp}>
                <div className="grp">{grp}</div>
                {shown.map(([href, label, , badge]) => (
                  <Link key={href} href={href}>{label}{badge ? <span className="badge">{badge}</span> : null}</Link>
                ))}
              </div>
            );
          })}
        </nav>
        <div className="side-foot">
          Local build · phase 1
          <form action={logoutAction}><button type="submit">Sign out</button></form>
        </div>
      </aside>
      <div>
        <header className="top">
          <form className="search" action="/search">
            <input type="search" name="q" placeholder="Search plate, mobile, VIN, name, job card, invoice, part no." aria-label="Search" />
          </form>
          {branches.length > 1 ? (
            <form action={switchBranchAction}>
              <input type="hidden" name="$back" value="/" />
              <AutoSubmitSelect name="branch_id" defaultValue={ctx.currentBranchId ?? ""} aria-label="Branch" style={{ minWidth: 190 }}>
                {branches.map((b) => <option key={b.id} value={b.id}>{b.code} · {b.name_en}</option>)}
              </AutoSubmitSelect>
            </form>
          ) : (
            <span className="pill">{branches[0]?.code} · {branches[0]?.name_en}</span>
          )}
          <div className="who"><b>{ctx.fullName}</b><br />{role?.roleName}{ctx.allBranches ? " · all branches" : ""}</div>
        </header>
        <main className="main">{children}</main>
      </div>
    </div>
  );
}

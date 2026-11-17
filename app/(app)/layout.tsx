import Link from "next/link";
import { requireCtx } from "@/lib/session";
import { canAnywhere, roleAt } from "@/lib/access";
import { shellData } from "@/lib/services/home";
import { logoutAction, switchBranchAction } from "@/app/actions";
import { AutoSubmitSelect } from "@/components/AutoSubmit";
import { SideNav, type NavGroup } from "@/components/SideNav";
import { PhoneTables } from "@/components/PhoneTables";

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
    ["Workshop", [
      ["/workshop", "Workshop board", can("workshop")],
      ["/my-jobs", "My jobs", role?.roleCode === "technician"],
    ]],
    ["Parts", [
      ["/stock", "Stock on hand", can("stock")],
      ["/stock/planning", "Planning and back orders", can("stock")],
      ["/stock/queue", "Store queue", can("stock")],
      ["/stock/transfers", "Transfers", can("stock")],
      ["/stock/adjustments", "Adjustments and counts", can("stock")],
    ]],
    ["Purchasing", [
      ["/purchasing", "Purchase orders", can("purchasing")],
      ["/purchasing/bills", "Supplier bills", can("purchasing") || can("accounting")],
      ["/purchasing/petty-cash", "Petty cash", can("purchasing") || can("accounting")],
    ]],
    ["Billing", [
      ["/invoices", "Invoices", can("invoices")],
      ["/billing/counter-sale", "Counter sale", can("invoices", "create")],
      ["/billing/advances", "Advances", can("invoices")],
      ["/billing/cheques", "Cheques", can("invoices")],
      ["/billing/credit-notes", "Credit notes", can("invoices")],
      ["/billing/cash", "Cash closing", can("invoices")],
    ]],
    ["Accounting", [
      ["/accounts", "Financial statements", can("accounting")],
      ["/accounts/ledger", "Ledgers and vouchers", can("accounting")],
      ["/accounts/receivables", "Receivables", can("accounting")],
      ["/accounts/payables", "Payables and payments", can("accounting")],
      ["/accounts/bank", "Bank and reconciliation", can("accounting")],
      ["/accounts/vat", "VAT return", can("accounting")],
      ["/accounts/periods", "Month end", can("accounting")],
    ]],
    ["Administration", [
      ["/admin/branches", "Branches", can("admin")],
      ["/admin/users", "Users & access", can("admin")],
      ["/admin/roles", "Roles & permissions", can("admin")],
      ["/admin/masters", "Master forms", can("settings")],
      ["/admin/workflows", "Approval workflows", can("settings")],
      ["/admin/numbering", "Document numbering", can("settings")],
      ["/admin/settings", "Settings", can("settings")],
      ["/admin/audit", "Audit log", can("admin")],
    ]],
  ];
  const groups: NavGroup[] = menu
    .map(([label, items]) => ({ key: label.toLowerCase().replace(/[^a-z]+/g, "-"), label, items: items.filter((i) => i[2]).map(([href, l, , badge]) => ({ href, label: l, badge })) }))
    .filter((g) => g.items.length);
  return (
    <div className="app">
      <aside className="side">
        <input type="checkbox" id="navtoggle" className="navtoggle" aria-hidden />
        <div className="brand"><div className="mk">A</div><div><b>AUTOVIQO</b><small>Smart Garage ERP</small></div>
          <label htmlFor="navtoggle" className="menubtn" aria-label="Open or close the menu">☰ Menu</label></div>
        <div className="client">{/* eslint-disable-next-line @next/next/no-img-element */}<img src="/sflogo.png" alt="Superfix" /><span>Super Fix Auto Centers</span></div>
        <SideNav groups={groups} />
        <div className="side-foot">
          Local build · phase 4
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
        <main className="main">{children}</main><PhoneTables />
      </div>
    </div>
  );
}

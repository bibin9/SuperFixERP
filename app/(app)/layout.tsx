import Link from "next/link";
import { requireCtx } from "@/lib/session";
import { canAnywhere, roleAt } from "@/lib/access";
import { shellData } from "@/lib/services/home";
import { seesPayroll } from "@/lib/services/payroll";
import { visibleReports } from "@/lib/services/reports";
import { menuReports, unreadInbox } from "@/lib/services/report-saved";
import { logoutAction, switchBranchAction } from "@/app/actions";
import { AutoSubmitSelect } from "@/components/AutoSubmit";
import { SideNav, type NavGroup } from "@/components/SideNav";
import { PhoneTables } from "@/components/PhoneTables";
import { PHONE_TABLES_INLINE } from "@/lib/phone-tables";
import { FormErrors } from "@/components/FormErrors";
import { Suspense } from "react";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireCtx();
  const { branches, pending } = await shellData(ctx);
  const role = roleAt(ctx, ctx.currentBranchId);
  const can = (s: Parameters<typeof canAnywhere>[1], a: Parameters<typeof canAnywhere>[2] = "view") => canAnywhere(ctx, s, a);
  const seesReports = visibleReports(ctx).length > 0;
  const savedMenu = seesReports ? await menuReports(ctx) : [];
  const unread = seesReports ? await unreadInbox(ctx) : 0;
  const menu: [string, [string, string, boolean, number?][]][] = [
    ["Front office", [
      ["/", "Home", true],
      ["/enquiries", "Enquiries", can("customers")],
      ["/bookings", "Booking calendar", can("customers")],
      ["/customers", "Customers & vehicles", can("customers")],
      ["/jobs", "Job cards", can("jobs") || can("workshop")],
      ["/approvals", "Approvals", can("approvals"), pending],
    ]],
    ["Workshop", [
      ["/workshop", "Workshop board", can("workshop")],
      ["/my-jobs", "My jobs", role?.roleCode === "technician"],
      ["/workshop/runs", "Pickup, drop-off and recovery", can("jobs") || can("customers") || can("workshop")],
    ]],
    ["Parts", [
      ["/stock", "Stock on hand", can("stock")],
      ["/stock/planning", "Planning and back orders", can("stock")],
      ["/stock/queue", "Store queue", can("stock")],
      ["/stock/transfers", "Transfer orders", can("stock")],
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
    ["HR", [
      ["/me", "My HR", true],
      ["/hr", "HR dashboard", can("hr")],
      ["/hr/employees", "Employees", can("hr")],
      ["/hr/attendance", "Attendance and roster", can("hr")],
      ["/hr/leave", "Leave and overtime", can("hr")],
      ["/hr/letters", "Letters", can("hr")],
      ["/hr/recruitment", "Recruitment", can("hr")],
    ]],
    ["Payroll", [
      ["/payroll", "Payroll runs", seesPayroll(ctx)],
      ["/payroll/revisions", "Salary updates", seesPayroll(ctx)],
      ["/payroll/loans", "Advances and loans", seesPayroll(ctx)],
      ["/payroll/settlements", "Final settlements", seesPayroll(ctx)],
    ]],
    ["Reports", [
      ["/reports", "Reports dashboard", seesReports],
      ["/reports/all", "All reports", seesReports],
      ...savedMenu.map((r): [string, string, boolean] => [`/reports/saved/${r.id}`, r.name, true]),
      ["/reports/builder", "Report builder", seesReports],
      ["/reports/inbox", "Report inbox", seesReports, unread],
      ["/reports/archive", "Archive", seesReports],
    ]],
    ["Administration", [
      ["/admin/branches", "Branches", can("admin")],
      ["/admin/users", "Users & access", can("admin")],
      ["/admin/roles", "Roles & permissions", can("admin")],
      ["/admin/masters", "Master forms", can("settings") || can("hr")],
      ["/admin/workflows", "Approval workflows", can("settings")],
      ["/admin/numbering", "Document numbering", can("settings")],
      ["/admin/settings", "Settings", can("settings")],
      ["/admin/audit", "Audit log", can("audit")],
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
        <div className="client">{/* eslint-disable-next-line @next/next/no-img-element */}<img src="/sflogo.png" alt="Superfix" width={56} height={30} /><span>Super Fix Auto Centers</span></div>
        <SideNav groups={groups} />
        <div className="side-foot">
          Local build · phase 6
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
        {/* Labels the phone card lists before first paint, so nothing shifts when the page hydrates. */}
        <script dangerouslySetInnerHTML={{ __html: PHONE_TABLES_INLINE }} /><PhoneTables /><Suspense fallback={null}><FormErrors /></Suspense>
      </div>
    </div>
  );
}

import Link from "next/link";
import { requireCtx } from "@/lib/session";
import { canAnywhere, roleAt } from "@/lib/access";
import { shellData, alertsFor } from "@/lib/services/home";
import { Bell } from "@/components/Bell";
import { FindFeature, type Feature } from "@/components/FindFeature";
import { TOPICS, accessChecker, topicText } from "@/lib/help";
import { seesPayroll } from "@/lib/services/payroll";
import { visibleReports, canOpenReport } from "@/lib/services/reports";
import { menuReports, unreadInbox } from "@/lib/services/report-saved";
import { logoutAction, switchBranchAction } from "@/app/actions";
import { AutoSubmitSelect } from "@/components/AutoSubmit";
import { SideNav, type NavGroup } from "@/components/SideNav";
import { PhoneTables } from "@/components/PhoneTables";
import { ListPager } from "@/components/ListPager";
import { RecentSearch } from "@/components/RecentSearch";
import { FileSizeGuard } from "@/components/FileSizeGuard";
import { HelpTour } from "@/components/HelpTour";
import { Icon } from "@/components/Icon";
import { PHONE_TABLES_INLINE } from "@/lib/phone-tables";
import { FormErrors } from "@/components/FormErrors";
import { AutoLabels } from "@/components/AutoLabels";
import { Suspense } from "react";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireCtx();
  const { branches, pending, lowStock, lateJobs, keyDrops, pageSize } = await shellData(ctx);
  const role = roleAt(ctx, ctx.currentBranchId);
  const can = (s: Parameters<typeof canAnywhere>[1], a: Parameters<typeof canAnywhere>[2] = "view") => canAnywhere(ctx, s, a);
  const seesReports = visibleReports(ctx).length > 0;
  const seesOwner = canOpenReport(ctx, { module: "jobs" });
  const ownerHome = seesOwner && role?.homeScreen === "dashboard";
  const savedMenu = seesReports ? await menuReports(ctx) : [];
  const unread = seesReports ? await unreadInbox(ctx) : 0;
  const menu: [string, [string, string, boolean, number?, string?][]][] = [
    ["Front office", [
      ["/owner", "Owner dashboard", seesOwner],
      [ownerHome ? "/?home=1" : "/", "Home", true],
      ["/enquiries", "Enquiries", can("customers")],
      ["/bookings", "Booking calendar", can("customers")],
      ["/workshop/keys", "Key drop", !!ctx.currentBranchId && can("customers"), keyDrops || undefined],
      ["/customers", "Customers & vehicles", can("customers")],
      ["/jobs", "Job cards", can("jobs") || can("workshop")],
      ["/approvals", "Approvals", can("approvals"), pending],
      ["/feedback", "Customer feedback", can("jobs")],
    ]],
    ["Workshop", [
      ["/workshop", "Workshop board", can("workshop"), undefined, lateJobs ? `${lateJobs} late` : undefined],
      ["/workshop/time", "Technician time", can("workshop")],
      ["/workshop/tablets", "Bay tablets", !!ctx.currentBranchId && canAnywhere(ctx, "workshop", "edit")],
      ["/my-jobs", "My jobs", role?.roleCode === "technician"],
      ["/workshop/runs", "Pickup & recovery", can("jobs") || can("customers") || can("workshop")],
    ]],
    ["Parts", [
      ["/stock", "Stock on hand", can("stock")],
      ["/stock/planning", "Parts planning", can("stock")],
      ["/stock/reorder", "Low stock", can("stock"), lowStock],
      ["/stock/queue", "Store queue", can("stock")],
      ["/stock/transfers", "Transfer orders", can("stock")],
      ["/stock/adjustments", "Stock adjustments", can("stock")],
    ]],
    ["Purchasing", [
      ["/purchasing", "Purchase orders", can("purchasing")],
      ["/purchasing/bills", "Supplier bills", can("purchasing") || can("accounting")],
      ["/purchasing/petty-cash", "Petty cash", can("purchasing") || can("accounting")],
      ["/purchasing/direct", "Buy for a job", can("purchasing")],
    ]],
    ["Billing", [
      ["/invoices", "Invoices", can("invoices")],
      ["/billing/counter-sale", "Counter sale", can("invoices", "create")],
      ["/billing/quick", "Quick job", can("invoices", "create") && can("jobs", "create")],
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
      ["/accounts/bank", "Bank & reconciliation", can("accounting")],
      ["/accounts/vat", "VAT return", can("accounting")],
      ["/accounts/periods", "Month end", can("accounting")],
    ]],
    ["HR", [
      ["/me", "My HR", true],
      ["/hr", "HR dashboard", can("hr")],
      ["/hr/employees", "Employees", can("hr")],
      ["/hr/attendance", "Attendance & roster", can("hr")],
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
      ["/admin/bundles", "Service bundles", can("settings")],
      ["/admin/workflows", "Approval workflows", can("settings")],
      ["/admin/numbering", "Document numbering", can("settings")],
      ["/admin/settings", "Settings", can("settings")],
      ["/admin/audit", "Audit log", can("audit")],
    ]],
    ["Help", [
      ["/help", "User guide", true],
      ["/help#flows", "Process flows", true],
    ]],
  ];
  const groups: NavGroup[] = menu
    .map(([label, items]) => ({ key: label.toLowerCase().replace(/[^a-z]+/g, "-"), label, items: items.filter((i) => i[2]).map(([href, l, , badge, badgeText]) => ({ href, label: l, badge, badgeText })) }))
    .filter((g) => g.items.length)
    // A quick-PIN session on a bay tablet shows only My jobs.
    .map((g) => ctx.pinOnly ? { ...g, items: g.items.filter((i) => i.href === "/my-jobs") } : g)
    .filter((g) => g.items.length);
  const alerts = ctx.pinOnly ? [] : await alertsFor(ctx);
  // "Find a feature": every screen in this person's menu, then every guide page they can use.
  const sees = accessChecker(ctx);
  const features: Feature[] = [
    ...groups.flatMap((g) => g.items.map((i): Feature => ({ k: "Screen", t: i.label, d: g.label, href: i.href, text: `${g.label} ${i.label}` }))),
    ...TOPICS.filter(sees).map((t): Feature => ({ k: "How to", t: t.title, d: t.summary, href: `/help/${t.slug}`, text: `${t.title} ${t.summary} ${t.who} ${t.parts.map((p) => p.h).join(" ")} ${topicText(t).slice(0, 500)}` })),
  ];
  return (
    <div className="app">
      <aside className="side">
        <input type="checkbox" id="navtoggle" className="navtoggle" aria-hidden />
        <div className="brand"><div className="mk" aria-hidden><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 15 12 4l9 11M7 15h10l-2 5H9z" /></svg></div><div><b>AUTOVIQO</b><small>for Superfix Auto Centers</small></div>
          <label htmlFor="navtoggle" className="menubtn" aria-label="Open or close the menu">☰ Menu</label></div>
        <div className="client">{/* eslint-disable-next-line @next/next/no-img-element */}<img src="/sflogo.png" alt="Superfix" width={74} height={40} /><span><b>Superfix</b>{branches.length} branch{branches.length === 1 ? "" : "es"}</span></div>
        <SideNav groups={groups} />
        <div className="side-foot">
          <div>Signed in as <b>{ctx.fullName}</b><br />{role?.roleName}{ctx.allBranches ? " · All branches" : ""}</div>
          <form action={logoutAction}><button type="submit">Sign out</button></form>
        </div>
      </aside>
      <div>
        <header className="top">
          <form className="search" action="/search" role="search">
            <Icon name="search" size={18} className="sicon" />
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
          {!ctx.pinOnly && <><FindFeature items={features} />
          <HelpTour allowed={TOPICS.filter(sees).map((t) => t.slug)} />
          <Bell alerts={alerts} /></>}
          <div className="clock" title="Today"><Icon name="clock" size={16} className="cicon" />{new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "Asia/Dubai" }).format(new Date())}</div>
          <div className="who"><span className="avatar" aria-hidden>{ctx.fullName.split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase()}</span><span><b>{ctx.fullName}</b><br />{role?.roleName}{ctx.allBranches ? " · all branches" : ""}</span></div>
        </header>
        <main className="main">{children}</main>
        {/* Labels the phone card lists before first paint, so nothing shifts when the page hydrates. */}
        <script dangerouslySetInnerHTML={{ __html: PHONE_TABLES_INLINE }} /><PhoneTables /><ListPager user={ctx.userId} defaultSize={pageSize} /><RecentSearch user={ctx.userId} /><AutoLabels /><FileSizeGuard /><Suspense fallback={null}><FormErrors /></Suspense>
      </div>
    </div>
  );
}

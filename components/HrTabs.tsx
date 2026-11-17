import Link from "next/link";

const GROUPS: Record<string, [string, string][]> = {
  hr: [["/hr", "HR dashboard"], ["/hr/employees", "Employees"], ["/hr/attendance", "Attendance"], ["/hr/roster", "Roster"], ["/hr/leave", "Leave"], ["/hr/overtime", "Overtime"],
    ["/hr/letters", "Letters"], ["/hr/transfers", "Transfers and org chart"], ["/hr/recruitment", "Recruitment"]],
  payroll: [["/payroll", "Payroll runs"], ["/payroll/revisions", "Salary updates"], ["/payroll/loans", "Advances and loans"], ["/payroll/settlements", "Final settlements"], ["/payroll/liabilities", "Gratuity and liabilities"]],
};

export function HrTabs({ group, at }: { group: keyof typeof GROUPS; at: string }) {
  return <div className="tabs no-print">{GROUPS[group].map(([h, l]) => <Link key={h} className={at === h ? "on" : ""} href={h}>{l}</Link>)}</div>;
}

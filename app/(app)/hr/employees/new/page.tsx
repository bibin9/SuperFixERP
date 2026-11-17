import { requireCtx } from "@/lib/session";
import { hrLookups } from "@/lib/services/hr";
import { assertCan, canSee } from "@/lib/access";
import { createEmployeeAction } from "@/app/actions-hr";
import { Flash, Link, PageHead } from "@/components/ui";
import { EmployeeForm } from "@/components/EmployeeForm";

export default async function NewEmployee({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const ctx = await requireCtx();
  const sp = await searchParams;
  assertCan(ctx, "hr", "create");
  const l = await hrLookups(ctx);
  return (
    <>
      <PageHead title="New employee" sub="The joining checklist is created with the file. Enter the salary on the next screen."><Link className="btn ghost sm" href="/hr/employees">Employees</Link></PageHead>
      <Flash sp={sp} />
      <form className="card" action={createEmployeeAction}>
        <EmployeeForm l={l} isNew showBank={canSee(ctx, "salary", ctx.currentBranchId)} />
        <button className="btn">Add employee</button>
      </form>
    </>
  );
}

import { requireCtx } from "@/lib/session";
import { masters } from "@/lib/services/masters";
import { CustomerForm } from "@/components/CustomerForm";
import { Flash, PageHead } from "@/components/ui";

export default async function NewCustomer({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const ctx = await requireCtx();
  const sp = await searchParams;
  const m = await masters(ctx);
  return (
    <>
      <PageHead title="New customer" sub="Mobile, VIN and plate are checked against every branch before saving." />
      <Flash sp={sp} />
      <div className="card"><CustomerForm back="/customers/new" countries={m.countries} titles={m.titles} lookups={m.lookups} dups={sp.dups ? JSON.parse(sp.dups) : undefined} c={sp.form ? JSON.parse(sp.form) : undefined} /></div>
    </>
  );
}

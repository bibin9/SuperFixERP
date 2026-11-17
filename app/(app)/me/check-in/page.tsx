import { requireCtx } from "@/lib/session";
import { checkInAction } from "@/app/actions-hr";
import { Flash, Link, PageHead } from "@/components/ui";

/** Landing page of the branch QR code: one button checks in with today's code. */
export default async function QrCheckIn({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  await requireCtx();
  const sp = await searchParams;
  return (
    <>
      <PageHead title="Check in with the branch code" sub={`Branch ${sp.branch ?? ""}`} />
      <Flash sp={sp} />
      <div className="card">
        {sp.ok ? <p><Link className="btn" href="/me">Back to My HR</Link></p> : (
          <form action={checkInAction}><input type="hidden" name="branch" value={sp.branch ?? ""} /><input type="hidden" name="code" value={sp.code ?? ""} /><input type="hidden" name="$back" value="/me" />
            <button className="btn green">Check in or out now</button></form>)}
      </div>
    </>
  );
}

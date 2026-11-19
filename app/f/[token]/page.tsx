import { getPublicFeedback } from "@/lib/services/feedback";
import { publicFeedbackAction } from "@/app/actions-front";

export const dynamic = "force-dynamic";

export default async function Feedback({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<Record<string, string>> }) {
  const { token } = await params;
  const sp = await searchParams;
  const f = await getPublicFeedback(token);
  if (!f) return <main className="public"><div className="card">This link is not valid or has expired.</div></main>;
  const name = f.customer_type === "individual" ? `${f.title} ${f.first_name}` : f.company_name;
  return (
    <main className="public">
      <div className="card">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/sflogo.png" alt="Superfix" width={82} height={44} />
        <h1 style={{ marginTop: 8 }}>How did we do?</h1>
        <p className="sub">Dear {name}, thank you for bringing your {f.make} {f.model} to Superfix {f.branch_name} (job {f.doc_no}).</p>
        {sp.err && <div className="flash err">{sp.err}</div>}
        {f.rating ? (
          <div className="flash ok">Thank you for your rating of {f.rating} out of 5.{f.rating <= 2 ? ` We are sorry. The branch manager will call you. You can also reach us on ${f.branch_phone}.` : " We hope to see you again."}</div>
        ) : (
          <form action={publicFeedbackAction}>
            <input type="hidden" name="token" value={token} />
            <fieldset className="stars"><legend>Your rating</legend>
              {[5, 4, 3, 2, 1].map((n) => <span key={n}><input type="radio" id={`r${n}`} name="rating" value={n} required /><label htmlFor={`r${n}`} title={`${n} out of 5`}>★</label></span>)}
            </fieldset>
            <div className="field"><label htmlFor="comment">Anything you want to tell us (optional)</label><textarea id="comment" name="comment" maxLength={1000} rows={4} /></div>
            <button className="btn green" style={{ width: "100%", minHeight: 48 }}>Send my rating</button>
          </form>
        )}
      </div>
    </main>
  );
}

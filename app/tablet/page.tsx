import { cookies } from "next/headers";
import Link from "next/link";
import { tabletByToken, tabletPeople, TABLET_COOKIE } from "@/lib/services/tablets";
import { pinLoginAction } from "@/app/actions";
import { PinPad } from "@/components/PinPad";

export const dynamic = "force-dynamic";

/** The shared bay tablet: tap your name, type your 4-digit PIN, and My jobs opens. */
export default async function Tablet({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const t = await tabletByToken((await cookies()).get(TABLET_COOKIE)?.value);
  if (!t) {
    return (
      <main className="public" style={{ maxWidth: 520, marginTop: 80 }}>
        <div className="card">
          <h1>This device is not a bay tablet</h1>
          <p>A foreman or branch manager signs in on this device, opens <b>Workshop, Bay tablets</b> and presses <b>Make this device a bay tablet</b>.</p>
          <p><Link className="btn" href="/login">Sign in with a password</Link></p>
        </div>
      </main>
    );
  }
  const people = await tabletPeople(t);
  const who = people.find((p) => p.id === sp.u);
  return (
    <main className="tablet">
      <header><div><b>AUTOVIQO</b><small>{t.name}</small></div><Link href="/login" className="tablet-pw">Sign in with a password</Link></header>
      {!who ? (
        <>
          <h1>Tap your name</h1>
          {!people.length && <p className="muted">No technician at this branch has set a PIN yet. Sign in with your password on your phone, open <b>My jobs</b> and set your tablet PIN.</p>}
          <div className="tablet-people">
            {people.map((p) => (
              <Link key={p.id} href={`/tablet?u=${p.id}`} className="tablet-person">
                <span className="avatar big">{p.full_name.split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase()}</span>{p.full_name}
              </Link>
            ))}
          </div>
        </>
      ) : (
        <div className="tablet-pin">
          <span className="avatar big">{who.full_name.split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase()}</span>
          <h1>{who.full_name}</h1>
          <p className="muted">Type your 4-digit PIN</p>
          {sp.err && <div className="flash err">{sp.err}</div>}
          <PinPad userId={who.id} action={pinLoginAction} />
          <Link href="/tablet" className="btn ghost">Not you? Back to names</Link>
        </div>
      )}
      <p className="tablet-foot">The PIN only opens My jobs. The tablet locks after 2 minutes without a touch.</p>
    </main>
  );
}

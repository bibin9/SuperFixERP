import { loginAction } from "@/app/actions";

export default async function Login({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  return (
    <main className="public" style={{ maxWidth: 420, marginTop: 80 }}>
      <div className="card">
        <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 14 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/sflogo.png" alt="Superfix" width={82} height={44} />
          <div><b style={{ fontSize: 18 }}>AUTOVIQO</b><div className="muted small">Superfix garage ERP · local build</div></div>
        </div>
        {sp.err && <div className="flash err">{sp.err}</div>}
        <form action={loginAction}>
          <div className="field"><label htmlFor="u">User name</label><input id="u" name="username" autoComplete="username" required autoFocus /></div>
          <div className="field"><label htmlFor="p">Password</label><input id="p" name="password" type="password" autoComplete="current-password" required /></div>
          <button className="btn" style={{ width: "100%" }}>Sign in</button>
        </form>
        {/* SEC-01: the demo user list and password show only on a local build that asks for it (SHOW_DEMO_USERS=true). */}
        {process.env.SHOW_DEMO_USERS === "true" && <p className="muted small" style={{ marginTop: 14 }}>
          Demo users (password <b>Superfix@2026</b>): admin, saeed (owner), yousef (Yas manager), priya (Yas advisor), khalid (foreman), ramesh (technician),
          anil (stock keeper), maryam (accountant), omar (Al Qusais manager), sara (Al Qusais advisor).
        </p>}
      </div>
    </main>
  );
}

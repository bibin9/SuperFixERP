import { requireCtx } from "@/lib/session";
import { listTablets } from "@/lib/services/tablets";
import { tabletSetupAction, removeTabletAction, clearPinAction } from "@/app/actions";
import { Flash, PageHead } from "@/components/ui";
import { ConfirmButton } from "@/components/ConfirmButton";

/** Bay tablets for quick PIN sign-in, and which technicians have a PIN. */
export default async function Tablets({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const ctx = await requireCtx();
  const sp = await searchParams;
  const x = await listTablets(ctx);
  return (
    <>
      <PageHead title="Bay tablets" sub="Shared tablets in the workshop where technicians tap their name and type a 4-digit PIN instead of the password." />
      <Flash sp={sp} />
      <div className="grid2">
        <div className="card">
          <h2>Make this device a bay tablet</h2>
          <p className="small">Do this <b>on the tablet itself</b>: sign in there with your own password, open this page and press the button. You are signed out and the tablet shows the technicians&apos; names. The PIN only works on tablets added here, and only opens My jobs.</p>
          <form action={tabletSetupAction} className="row" style={{ alignItems: "flex-end" }}>
            <div className="field" style={{ flex: 1, margin: 0 }}><label htmlFor="tname">Tablet name</label><input id="tname" name="name" required maxLength={60} placeholder="Bay 2 tablet" /></div>
            <button className="btn shrink">Make this device a bay tablet</button>
          </form>
          <h3>Tablets at this branch</h3>
          {x.tablets.length ? <table><thead><tr><th>Tablet</th><th>Added</th><th>Last sign-in</th><th><span className="vh">Actions</span></th></tr></thead><tbody>
            {x.tablets.map((t) => <tr key={t.id}><td><b>{t.name}</b>{!t.active && <span className="pill grey" style={{ marginLeft: 6 }}>Removed</span>}</td><td className="small">{t.added}{t.added_by ? ` · ${t.added_by}` : ""}</td><td className="small">{t.last_used ?? "Not yet"}</td>
              <td>{t.active && <form action={removeTabletAction}><input type="hidden" name="tablet_id" value={t.id} /><ConfirmButton className="btn ghost sm" message={`Remove ${t.name}? Anyone signed in on it is signed out.`}>Remove</ConfirmButton></form>}</td></tr>)}
          </tbody></table> : <p className="muted small">No tablets yet.</p>}
        </div>
        <div className="card">
          <h2>Technicians and their PIN</h2>
          <p className="small">Each technician sets their own PIN on <b>My jobs</b> after signing in with the password. If someone forgets it, or it was seen by others, clear it here.</p>
          <table><thead><tr><th>Technician</th><th>PIN</th><th><span className="vh">Actions</span></th></tr></thead><tbody>
            {x.techs.map((u) => <tr key={u.id}><td>{u.full_name}</td><td>{u.has_pin ? <span className="pill green">Set</span> : <span className="pill grey">Not set</span>}</td>
              <td>{u.has_pin && <form action={clearPinAction}><input type="hidden" name="user_id" value={u.id} /><button className="btn ghost sm">Clear PIN</button></form>}</td></tr>)}
          </tbody></table>
        </div>
      </div>
    </>
  );
}

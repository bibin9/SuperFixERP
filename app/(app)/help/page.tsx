import Link from "next/link";
import { requireCtx } from "@/lib/session";
import { roleAt } from "@/lib/access";
import { PageHead } from "@/components/ui";
import { TOPICS, FLOWS, GROUPS, accessChecker, topicText } from "@/lib/help";
import { HelpText } from "@/components/HelpText";

export const metadata = { title: "User guide · AUTOVIQO" };

export default async function HelpHome({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const ctx = await requireCtx();
  const sp = await searchParams;
  const all = sp.all === "1";
  const q = (sp.q ?? "").trim().toLowerCase();
  const mine = accessChecker(ctx);
  const role = roleAt(ctx, ctx.currentBranchId);
  const topics = TOPICS.filter((t) => all || mine(t));
  const flows = FLOWS.filter((f) => all || mine(f));
  const words = q.split(/\s+/).filter(Boolean);
  const hits = q ? TOPICS.filter((t) => { const x = topicText(t).toLowerCase(); return words.every((w) => x.includes(w)); }) : [];
  const hidden = TOPICS.length - topics.length;
  return (
    <>
      <PageHead title="User guide" sub={all ? "Every guide, for every role" : `Guides for what you can do as ${role?.roleName ?? "a user"}`}>
        {hidden > 0 && !all && <Link className="btn ghost sm" href="/help?all=1">Show every guide ({TOPICS.length})</Link>}
        {all && <Link className="btn ghost sm" href="/help">Only my guides</Link>}
        <Link className="btn ghost sm" href="#flows">Process flows</Link>
      </PageHead>

      <form className="card help-search" action="/help" role="search">
        <label htmlFor="hq"><b>What do you want to do?</b></label>
        <div className="row" style={{ gap: 8 }}>
          <input id="hq" type="search" name="q" defaultValue={sp.q ?? ""} placeholder="For example: take a payment, add a vehicle, apply for leave" />
          <button className="btn shrink" type="submit">Search the guide</button>
        </div>
      </form>

      {q && (
        <div className="card">
          <h2>{hits.length ? `${hits.length} guide${hits.length > 1 ? "s" : ""} found` : "Nothing found"}</h2>
          {!hits.length && <p className="muted">Try fewer or simpler words, for example &quot;invoice&quot; or &quot;leave&quot;.</p>}
          <ul className="help-list">{hits.map((t) => <li key={t.slug}><Link href={`/help/${t.slug}`}><b>{t.title}</b></Link><span className="muted"> · {t.group}</span><br /><span className="small">{t.summary}</span></li>)}</ul>
        </div>
      )}

      <div className="card help-start">
        <h2>New to Superfix? Start here</h2>
        <ol className="small">
          <li><Link href="/help/sign-in">Signing in and finding your way</Link>: the menu, branch, search and sign out.</li>
          <li><Link href="/help/basics">Things that work the same everywhere</Link>: forms, red error messages, approvals, WhatsApp, printing.</li>
          <li><Link href="/help/roles">Who does what</Link>: the job of each role.</li>
          <li>Then open the guide for your work below. On any screen, press <b className="ui-name">? Help</b> at the top to open the guide for that screen.</li>
        </ol>
      </div>

      {GROUPS.filter((g) => g !== "Getting started").map((g) => {
        const list = topics.filter((t) => t.group === g);
        if (!list.length) return null;
        return (
          <section key={g} className="help-group">
            <h2>{g}</h2>
            <div className="help-cards">
              {list.map((t) => (
                <Link key={t.slug} href={`/help/${t.slug}`} className="card help-card">
                  <b>{t.title}</b>
                  <span className="small"><HelpText t={t.summary} /></span>
                  <span className="small muted">For: {t.who}</span>
                </Link>
              ))}
            </div>
          </section>
        );
      })}

      <section id="flows" className="help-group">
        <h2>Process flows</h2>
        <p className="small muted">Each flow shows who does each step, in order, and opens the screen for it.</p>
        <div className="help-cards">
          {flows.map((f) => (
            <Link key={f.slug} href={`/help/flows/${f.slug}`} className="card help-card flowcard">
              <b>{f.title}</b>
              <span className="small">{f.summary}</span>
              <span className="small muted">{f.steps.length} steps</span>
            </Link>
          ))}
        </div>
      </section>
    </>
  );
}

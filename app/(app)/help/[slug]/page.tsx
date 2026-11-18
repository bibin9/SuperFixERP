import Link from "next/link";
import { notFound } from "next/navigation";
import { requireCtx } from "@/lib/session";
import { PageHead } from "@/components/ui";
import { PrintButton } from "@/components/PrintButton";
import { TOPICS, topicBySlug, flowBySlug, accessChecker } from "@/lib/help";
import { HelpText } from "@/components/HelpText";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const t = topicBySlug((await params).slug);
  return { title: `${t?.title ?? "Guide"} · AUTOVIQO` };
}

export default async function HelpTopicPage({ params }: { params: Promise<{ slug: string }> }) {
  const ctx = await requireCtx();
  const { slug } = await params;
  const t = topicBySlug(slug);
  if (!t) notFound();
  const mine = accessChecker(ctx);
  const canUse = mine(t);
  const i = TOPICS.indexOf(t);
  const prev = TOPICS[i - 1], next = TOPICS[i + 1];
  return (
    <article className="help-topic">
      <p className="small no-print"><Link href="/help">User guide</Link> › {t.group}</p>
      <PageHead title={t.title} sub={`For: ${t.who}`}>
        {t.open && canUse && <Link className="btn sm no-print" href={t.open.href}>{t.open.label}</Link>}
        <span className="no-print"><PrintButton label="Print or save as PDF" /></span>
      </PageHead>
      <p className="help-summary"><HelpText t={t.summary} /></p>
      {!canUse && <p className="card small muted">Your role cannot open these screens. This guide is here so you know how the work is done; ask your manager if you need access.</p>}

      {t.parts.length > 2 && (
        <nav className="card help-toc no-print" aria-label="On this page">
          <b className="small">On this page</b>
          <ol className="small">{t.parts.map((p, n) => <li key={n}><a href={`#s${n + 1}`}>{p.h}</a></li>)}</ol>
        </nav>
      )}

      {t.parts.map((p, n) => (
        <section key={n} id={`s${n + 1}`} className="card help-part">
          <h2>{p.h}</h2>
          {p.intro && <p><HelpText t={p.intro} /></p>}
          {p.steps && (p.intro ? <ul className="help-steps bullets">{p.steps.map((s, k) => <li key={k}><HelpText t={s} /></li>)}</ul>
            : <ol className="help-steps">{p.steps.map((s, k) => <li key={k}><HelpText t={s} /></li>)}</ol>)}
          {p.tips?.map((s, k) => <p key={k} className="help-tip"><b>Good to know: </b><HelpText t={s} /></p>)}
        </section>
      ))}

      {t.flows?.length ? (
        <div className="card no-print">
          <h2>Process flows</h2>
          <ul className="help-list">{t.flows.map((s) => { const f = flowBySlug(s); return f && <li key={s}><Link href={`/help/flows/${s}`}>{f.title}</Link></li>; })}</ul>
        </div>
      ) : null}

      <nav className="row help-pager no-print" aria-label="More guides">
        {prev ? <Link className="btn ghost sm" href={`/help/${prev.slug}`}>‹ {prev.title}</Link> : <span />}
        {next ? <Link className="btn ghost sm" href={`/help/${next.slug}`}>{next.title} ›</Link> : <span />}
      </nav>
    </article>
  );
}

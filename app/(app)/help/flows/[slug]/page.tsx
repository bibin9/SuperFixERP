import Link from "next/link";
import { notFound } from "next/navigation";
import { requireCtx } from "@/lib/session";
import { PageHead } from "@/components/ui";
import { PrintButton } from "@/components/PrintButton";
import { flowBySlug, topicBySlug } from "@/lib/help";
import { FlowDiagram } from "@/components/FlowDiagram";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const f = flowBySlug((await params).slug);
  return { title: `${f?.title ?? "Process flow"} · AUTOVIQO` };
}

export default async function FlowPage({ params }: { params: Promise<{ slug: string }> }) {
  await requireCtx();
  const { slug } = await params;
  const f = flowBySlug(slug);
  if (!f) notFound();
  return (
    <>
      <p className="small no-print"><Link href="/help">User guide</Link> › <Link href="/help#flows">Process flows</Link></p>
      <PageHead title={f.title} sub={f.summary}><span className="no-print"><PrintButton label="Print or save as PDF" /></span></PageHead>
      <div className="card">
        <p className="small muted flow-key"><span className="fk staff">Staff</span><span className="fk mgr">Manager or approver</span><span className="fk cust">Customer</span><span className="fk sys">Done by the system</span></p>
        <FlowDiagram f={f} />
      </div>
      {f.topics?.length ? (
        <div className="card no-print">
          <h2>Step-by-step guides for this flow</h2>
          <ul className="help-list">{f.topics.map((s) => { const t = topicBySlug(s); return t && <li key={s}><Link href={`/help/${s}`}>{t.title}</Link></li>; })}</ul>
        </div>
      ) : null}
    </>
  );
}

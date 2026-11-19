"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { FRONT } from "@/lib/help/topics-front";
import { BACK } from "@/lib/help/topics-back";
import { FLOWS } from "@/lib/help/flows";
import { topicForPath } from "@/lib/help/screens";
import type { HelpTopic } from "@/lib/help/types";
import { HelpText } from "@/components/HelpText";

const TOPICS: HelpTopic[] = [...FRONT, ...BACK];
type Step = { part: string; partIdx: number; text: string; intro?: string };

/** The first **name** in a step is the button or field it talks about. */
const targetName = (t: string) => /\*\*([^*]+)\*\*/.exec(t)?.[1]?.trim() ?? null;
const plain = (t: string) => t.replace(/\*\*|\[|\]\([^)]*\)/g, "");

/** Finds the control on the page whose visible text or label matches the name in the step. */
function findOnPage(name: string): HTMLElement | null {
  const want = name.toLowerCase().replace(/[.…:]+$/, "").trim();
  if (!want || want.length < 2) return null;
  const main = document.querySelector("main.main") ?? document.body;
  const cands = Array.from(main.querySelectorAll<HTMLElement>("button, a, summary, label, th, h1, h2, h3, [role=tab], .tabs a, legend"));
  const vis = (e: HTMLElement) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== "hidden"; };
  const txt = (e: HTMLElement) => (e.innerText || e.getAttribute("aria-label") || "").toLowerCase().replace(/\s+/g, " ").trim();
  const exact = cands.find((e) => vis(e) && txt(e) === want);
  if (exact) return exact.tagName === "LABEL" ? (exact.closest(".field") as HTMLElement) ?? exact : exact;
  const part = cands.find((e) => vis(e) && txt(e).startsWith(want) && txt(e).length < want.length + 25);
  if (part) return part.tagName === "LABEL" ? (part.closest(".field") as HTMLElement) ?? part : part;
  const input = main.querySelector<HTMLElement>(`[aria-label="${CSS.escape(name)}" i], [placeholder*="${CSS.escape(name)}" i]`);
  return input && vis(input) ? input : null;
}

/**
 * Help in the top bar (Zoho-style help panel): opens a panel over the current screen with that screen's
 * guide as a step-by-step tour (screenshot, Back and Next), the process flow it belongs to, and
 * "Show me" which points at the real button or field on the page.
 */
export function HelpTour({ allowed }: { allowed: string[] }) {
  const path = usePathname() ?? "/";
  const router = useRouter();
  const ok = useMemo(() => new Set(allowed), [allowed]);
  const topics = useMemo(() => TOPICS.filter((t) => ok.has(t.slug)), [ok]);
  const [open, setOpen] = useState(false);
  const [slug, setSlug] = useState<string | null>(null);
  const [tab, setTab] = useState<"steps" | "flow">("steps");
  const [i, setI] = useState(0);
  const [spot, setSpot] = useState<{ el: HTMLElement; r: DOMRect } | null>(null);
  const [missing, setMissing] = useState(false);
  const [canShow, setCanShow] = useState(false);

  const pageSlug = topicForPath(path);
  useEffect(() => { setSlug(pageSlug && ok.has(pageSlug) ? pageSlug : null); setI(0); setSpot(null); }, [pageSlug, ok]);
  const topic = topics.find((t) => t.slug === slug) ?? null;
  const steps: Step[] = useMemo(() => !topic ? [] : topic.parts.flatMap((p, pi) =>
    (p.steps?.length ? p.steps : [p.intro ?? "", ...(p.tips ?? [])].filter(Boolean)).map((s, si) => ({ part: p.h, partIdx: pi, text: s, intro: si === 0 ? p.intro : undefined }))), [topic]);
  const step = steps[i];
  const flows = topic ? FLOWS.filter((f) => f.topics?.includes(topic.slug)) : [];

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === "F1") { e.preventDefault(); setOpen((o) => !o); }
      if (e.key === "Escape") { setSpot(null); setOpen(false); }
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, []);
  // Keep the pointer on its element while the page scrolls or resizes.
  useEffect(() => {
    if (!spot) return;
    const u = () => setSpot((s) => (s ? { el: s.el, r: s.el.getBoundingClientRect() } : s));
    window.addEventListener("scroll", u, true); window.addEventListener("resize", u);
    return () => { window.removeEventListener("scroll", u, true); window.removeEventListener("resize", u); };
  }, [spot]);

  // "Show me" is offered only when the button or field of this step is on the screen now.
  useEffect(() => {
    if (!open || !steps[i]) { setCanShow(false); return; }
    const name = targetName(steps[i].text);
    const t = setTimeout(() => setCanShow(!!(name && slug === pageSlug && findOnPage(name))), 50);
    return () => clearTimeout(t);
  }, [open, i, steps, slug, pageSlug]);
  const showMe = useCallback((idx: number) => {
    const s = steps[idx]; const name = s && targetName(s.text);
    const el = name ? findOnPage(name) : null;
    if (!el) { setSpot(null); setMissing(true); return; }
    setMissing(false);
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    setTimeout(() => setSpot({ el, r: el.getBoundingClientRect() }), 350);
  }, [steps]);
  const go = (n: number) => { const x = Math.max(0, Math.min(steps.length - 1, n)); setI(x); setMissing(false); if (spot) showMe(x); };

  if (path.startsWith("/help")) return null;
  const parts = topic ? topic.parts.map((p, pi) => ({ h: p.h, first: steps.findIndex((s) => s.partIdx === pi) })).filter((p) => p.first >= 0) : [];
  const onThisScreen = slug === pageSlug;

  return (
    <>
      <button type="button" className="btn ghost sm helplink" onClick={() => setOpen((o) => !o)} aria-expanded={open} title="Help for this screen (F1)">? Help</button>
      {open && (
        <aside className="htour" role="dialog" aria-label="Help for this screen">
          <div className="htour-h">
            <div><small>Help and tour</small><b>{topic?.title ?? "Help"}</b>{topic && <span className="muted small">{topic.who}</span>}</div>
            <button type="button" className="htour-x" onClick={() => { setOpen(false); setSpot(null); }} aria-label="Close help">×</button>
          </div>
          <div className="htour-pick">
            <select aria-label="Choose a help topic" value={slug ?? ""} onChange={(e) => { setSlug(e.target.value || null); setI(0); setSpot(null); setTab("steps"); }}>
              <option value="">Choose a topic…</option>
              {Array.from(new Set(topics.map((t) => t.group))).map((g) => <optgroup key={g} label={g}>{topics.filter((t) => t.group === g).map((t) => <option key={t.slug} value={t.slug}>{t.title}</option>)}</optgroup>)}
            </select>
          </div>
          {!topic ? (
            <div className="htour-b"><p className="muted">There is no tour for this screen yet. Pick a topic above, or open the <Link href="/help" onClick={() => setOpen(false)}>full guide</Link>.</p></div>
          ) : (<>
            <div className="htour-tabs" role="tablist">
              <button type="button" role="tab" aria-selected={tab === "steps"} className={tab === "steps" ? "on" : ""} onClick={() => setTab("steps")}>Step by step</button>
              <button type="button" role="tab" aria-selected={tab === "flow"} className={tab === "flow" ? "on" : ""} onClick={() => setTab("flow")}>Process flow{flows.length ? ` (${flows.length})` : ""}</button>
            </div>
            {tab === "steps" ? (
              <div className="htour-b">
                <p className="small muted" style={{ marginTop: 0 }}>{topic.summary}</p>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img className="htour-shot" src={`/help/shots/${topic.slug}.jpg`} alt={`The ${topic.title} screen`} onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                <div className="htour-parts">{parts.map((p) => <button type="button" key={p.h} className={step?.part === p.h ? "on" : ""} onClick={() => go(p.first)}>{p.h}</button>)}</div>
                {step && (
                  <div className="htour-step">
                    <div className="htour-n">Step {i + 1} of {steps.length} · {step.part}</div>
                    {step.intro && <p className="small muted">{plain(step.intro)}</p>}
                    <p><HelpText t={step.text} /></p>
                    {canShow && <button type="button" className="btn ghost sm" onClick={() => showMe(i)}>Show me on this page</button>}
                    {missing && <p className="small muted">That button is not on the screen right now. It appears at the step where you need it.</p>}
                  </div>
                )}
                <div className="htour-nav">
                  <button type="button" className="btn ghost sm" disabled={i === 0} onClick={() => go(i - 1)}>Back</button>
                  <div className="htour-dots" aria-hidden>{steps.map((_, k) => <span key={k} className={k === i ? "on" : k < i ? "done" : ""} />)}</div>
                  {i < steps.length - 1 ? <button type="button" className="btn sm" onClick={() => go(i + 1)}>Next</button>
                    : <button type="button" className="btn sm green" onClick={() => { setSpot(null); setI(0); }}>Done</button>}
                </div>
                <p className="small" style={{ marginTop: 12 }}>
                  {topic.open && !onThisScreen && <><Link href={topic.open.href}>{topic.open.label}</Link> · </>}
                  <Link href={`/help/${topic.slug}`} onClick={() => setOpen(false)}>Open the full guide page</Link>
                </p>
              </div>
            ) : (
              <div className="htour-b">
                {!flows.length && <p className="muted">This screen is not part of a longer process.</p>}
                {flows.map((f) => (
                  <div key={f.slug} className="htour-flow">
                    <b>{f.title}</b><p className="small muted">{f.summary}</p>
                    <ol>{f.steps.map((s, k) => {
                      const here = s.where && (path === s.where || path.startsWith(s.where + "/"));
                      return (
                        <li key={k} className={here ? "here" : ""}>
                          <span className="who">{s.who}</span>
                          {s.where && !here ? <button type="button" className="linkish" onClick={() => router.push(s.where!)}>{s.what}</button> : <span>{s.what}</span>}
                          {here && <span className="pill violet">You are here</span>}
                          {s.note && <small className="muted">{s.note}</small>}
                        </li>
                      );
                    })}</ol>
                  </div>
                ))}
              </div>
            )}
          </>)}
        </aside>
      )}
      {spot && step && (
        <div className="htour-spot" aria-live="polite">
          <div className="ring" style={{ top: spot.r.top - 6, left: spot.r.left - 6, width: spot.r.width + 12, height: spot.r.height + 12 }} />
          <div className="tip" style={{ top: Math.min(window.innerHeight - 180, spot.r.bottom + 12), left: Math.max(12, Math.min(window.innerWidth - 340, spot.r.left)) }}>
            <div className="htour-n">Step {i + 1} of {steps.length}</div>
            <p><HelpText t={step.text} /></p>
            <div className="htour-nav">
              <button type="button" className="btn ghost sm" disabled={i === 0} onClick={() => go(i - 1)}>Back</button>
              <button type="button" className="btn ghost sm" onClick={() => setSpot(null)}>Close</button>
              {i < steps.length - 1 && <button type="button" className="btn sm" onClick={() => go(i + 1)}>Next</button>}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

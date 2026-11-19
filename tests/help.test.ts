// The in-app user guide: every link, flow and screen mapping points at something real.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { TOPICS, FLOWS, topicBySlug, flowBySlug } from "../lib/help";
import { topicForPath, SCREEN_TOPIC } from "../lib/help/screens";

const APP = path.join(__dirname, "..", "app", "(app)");
function routeExists(href: string) {
  const p = href.split(/[?#]/)[0];
  if (p === "/") return true;
  const dir = path.join(APP, ...p.split("/").filter(Boolean));
  return fs.existsSync(path.join(dir, "page.tsx"));
}

test("guide slugs are unique and every topic has steps", () => {
  assert.equal(new Set(TOPICS.map((t) => t.slug)).size, TOPICS.length);
  assert.equal(new Set(FLOWS.map((f) => f.slug)).size, FLOWS.length);
  for (const t of TOPICS) assert.ok(t.parts.length && t.parts.every((p) => (p.steps?.length ?? 0) > 0), t.slug);
});

test("every link in the guide opens a real screen or guide", () => {
  const links: string[] = [];
  for (const t of TOPICS) {
    if (t.open) links.push(t.open.href);
    for (const p of t.parts) for (const s of [...(p.steps ?? []), ...(p.tips ?? []), p.intro ?? ""]) for (const m of s.matchAll(/\]\(([^)]+)\)/g)) links.push(m[1]);
  }
  for (const f of FLOWS) for (const s of f.steps) if (s.where) links.push(s.where);
  for (const l of links) {
    if (l.startsWith("/help/")) assert.ok(topicBySlug(l.slice(6)), `missing guide ${l}`);
    else assert.ok(routeExists(l), `missing screen ${l}`);
  }
});

test("flows and topics refer to each other correctly", () => {
  for (const t of TOPICS) for (const s of t.flows ?? []) assert.ok(flowBySlug(s), `${t.slug} -> flow ${s}`);
  for (const f of FLOWS) for (const s of f.topics ?? []) assert.ok(topicBySlug(s), `${f.slug} -> topic ${s}`);
});

test("the Help button finds a guide for every screen in the app", () => {
  for (const [, slug] of SCREEN_TOPIC) assert.ok(topicBySlug(slug), slug);
  const pages: string[] = [];
  const walk = (d: string, rel: string) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { if (e.isDirectory()) walk(path.join(d, e.name), `${rel}/${e.name}`); else if (e.name === "page.tsx") pages.push(rel || "/"); } };
  walk(APP, "");
  const missing = pages.filter((p) => p !== "/" && !p.startsWith("/help") && !p.startsWith("/search")).map((p) => p.replace(/\[[^\]]+\]/g, "x")).filter((p) => !topicForPath(p));
  assert.deepEqual(missing, []);
  assert.equal(topicForPath("/jobs/abc/invoice"), "invoicing");
  assert.equal(topicForPath("/jobs/abc"), "job-card");
  assert.equal(topicForPath("/stock/queue"), "store-queue");
});

test("every guide topic has a screenshot for the help panel", () => {
  for (const t of TOPICS) assert.ok(fs.existsSync(path.join(process.cwd(), "public", "help", "shots", `${t.slug}.jpg`)), `${t.slug}.jpg`);
});

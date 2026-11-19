import { syncPunches } from "@/lib/services/punch-devices";
import { AppError } from "@/lib/errors";

/**
 * Biometric sync: a punching machine (or the sync program beside it) sends its punches here.
 * Authorization: Bearer <machine key from HR, Punching machines>.
 * Body: JSON {"punches":[{"emp_no":"E0012","at":"2026-11-19 07:58"}]} or CSV with "Employee no" and "Date time" columns.
 */
export async function POST(req: Request) {
  const key = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  const type = req.headers.get("content-type") ?? "";
  const body = await req.text();
  if (body.length > 2_000_000) return Response.json({ error: "Too large" }, { status: 413 });
  let punches: { emp_no: string; at: string }[] = [];
  try {
    if (type.includes("json")) {
      const j = JSON.parse(body);
      punches = Array.isArray(j?.punches) ? j.punches.map((p: { emp_no?: unknown; at?: unknown }) => ({ emp_no: String(p?.emp_no ?? ""), at: String(p?.at ?? "") })) : [];
    } else {
      const lines = body.replace(/^﻿/, "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      const head = (lines[0] ?? "").toLowerCase().split(/[,;\t]/).map((h) => h.replace(/[^a-z]/g, ""));
      const iEmp = head.findIndex((h) => ["employeeno", "empno", "employee", "userid", "acno", "badge"].includes(h));
      const iDT = head.findIndex((h) => ["datetime", "checktime", "punchtime"].includes(h));
      if (iEmp < 0 || iDT < 0) return Response.json({ error: 'Needs "Employee no" and "Date time" columns' }, { status: 400 });
      punches = lines.slice(1).map((l) => { const c = l.split(/[,;\t]/).map((x) => x.trim().replace(/^"|"$/g, "")); return { emp_no: c[iEmp] ?? "", at: c[iDT] ?? "" }; });
    }
  } catch { return Response.json({ error: "Body not understood" }, { status: 400 }); }
  try {
    const r = await syncPunches(key, punches);
    if (!r) return Response.json({ error: "Unknown or switched-off machine key" }, { status: 401 });
    return Response.json(r);
  } catch (e) {
    if (e instanceof AppError) return Response.json({ error: e.message }, { status: 400 });
    throw e;
  }
}

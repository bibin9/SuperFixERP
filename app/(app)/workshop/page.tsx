import { headers } from "next/headers";
import { requireCtx } from "@/lib/session";
import { board } from "@/lib/services/workshop";
import { newBoardLinkAction } from "@/app/actions-ops";
import { AutoRefresh } from "@/components/AutoRefresh";
import { ConfirmButton } from "@/components/ConfirmButton";
import { CopyButton } from "@/components/CopyButton";
import { Flash, PageHead } from "@/components/ui";
import { BoardTiles } from "./BoardTiles";

export default async function WorkshopPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const ctx = await requireCtx();
  const sp = await searchParams;
  const w = await board(ctx);
  const h = await headers();
  const url = `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host") ?? "localhost:3000"}/board/${w.branch.board_token}`;
  return (
    <>
      <PageHead title="Workshop board" sub={`${w.branch.code} · ${w.branch.name_en} · refreshes every ${w.refresh} seconds`} />
      <Flash sp={sp} />
      <AutoRefresh seconds={w.refresh} />
      <p className="small"><span className="pill green">On time</span> <span className="pill amber">Due soon</span> <span className="pill red">Late</span></p>
      <BoardTiles jobs={w.jobs} link />
      {w.showToken && <div className="card no-print"><h2>Wall screen</h2>
        <p className="small muted">Open this link on the workshop TV. It shows this board without signing in and has no prices or customer names. Make a new link if the old one was shared by mistake.</p>
        <div className="row" style={{ alignItems: "center" }}><input readOnly value={url} aria-label="Wall-screen link" /><span className="shrink"><CopyButton text={url} label="Copy" /></span></div>
        <form action={newBoardLinkAction} style={{ marginTop: 8 }}><ConfirmButton className="btn ghost sm" message="Make a new link? The TV using the old link stops working.">Make a new link</ConfirmButton></form>
      </div>}
    </>
  );
}

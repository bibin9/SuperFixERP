import { notFound } from "next/navigation";
import { publicBoard } from "@/lib/services/workshop";
import { AutoRefresh } from "@/components/AutoRefresh";
import { BoardTiles } from "@/app/(app)/workshop/BoardTiles";

export const dynamic = "force-dynamic";

/** Wall screen (WS-01): no sign-in, no prices, no customer names. */
export default async function WallBoard({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const w = await publicBoard(token);
  if (!w) notFound();
  return (
    <div className="wall">
      <AutoRefresh seconds={w.refresh} />
      <h1>{w.branch.code} · {w.branch.name_en} · workshop</h1>
      <BoardTiles jobs={w.jobs} columns />
    </div>
  );
}

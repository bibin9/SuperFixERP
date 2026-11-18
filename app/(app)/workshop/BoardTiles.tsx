import { minutesText } from "@/lib/services/workshop";
import { STATUS_LABEL } from "@/lib/services/jobs";
import { Plate } from "@/components/ui";

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const COLS = ["approved", "awaiting_parts", "in_progress", "quality_check", "ready"];

/** Board tiles grouped by status; the colour shows time to the promised time (green, amber, red). */
export function BoardTiles({ jobs, link, columns }: { jobs: Row[]; link?: boolean; columns?: boolean }) {
  if (!jobs.length) return <p className="muted">No cars in the workshop.</p>;
  return (
    <div className={columns ? "wallcols" : ""}>{COLS.map((s) => {
      const list = jobs.filter((j) => j.status === s);
      if (!list.length && !columns) return null;
      return <section key={s} style={{ marginBottom: 16 }}><h2 style={{ fontSize: 15 }}>{STATUS_LABEL[s]} ({list.length})</h2>
        <div className={columns ? "colstack" : "board"}>{list.map((j) => {
          const body = <>
            <Plate v={j} /> <span className="small">{j.doc_no}</span>
            <div className="small">{j.make} {j.model}{j.bay_code ? ` · bay ${j.bay_code}` : ""}</div>
            <div className="small">{j.technicians ?? "Not assigned"}</div>
            <div className="small">{j.minutesLeft === null ? "No promised time" : j.minutesLeft >= 0 ? `Due in ${minutesText(j.minutesLeft)}` : `Late by ${minutesText(-j.minutesLeft)}`}{j.waiting_parts ? " · waiting for parts" : ""}</div>
          </>;
          return link ? <a key={j.id} href={`/jobs/${j.id}`} className={`tile ${j.colour}`} style={{ textDecoration: "none", color: "inherit" }}>{body}</a> : <div key={j.id} className={`tile ${j.colour}`}>{body}</div>;
        })}</div></section>;
    })}</div>
  );
}

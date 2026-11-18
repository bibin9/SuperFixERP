import Link from "next/link";
import type { HelpFlow } from "@/lib/help/types";

const tone = (who: string) => /customer/i.test(who) ? "cust" : /system/i.test(who) ? "sys" : /manager|owner|approver/i.test(who) ? "mgr" : "staff";

/** A process flow drawn as numbered boxes joined by arrows; reads top to bottom on a phone. */
export function FlowDiagram({ f }: { f: HelpFlow }) {
  return (
    <ol className="flow" aria-label={`Steps of ${f.title}`}>
      {f.steps.map((s, i) => (
        <li key={i} className={`fstep ${tone(s.who)}`}>
          <span className="fnum" aria-hidden>{i + 1}</span>
          <div className="fbody">
            <span className="fwho">{s.who}</span>
            <span className="fwhat">{s.what}</span>
            {s.note && <span className="fnote">{s.note}</span>}
            {s.where && <Link className="fwhere" href={s.where}>Open the screen</Link>}
          </div>
        </li>
      ))}
    </ol>
  );
}

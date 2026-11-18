import Link from "next/link";

/** Renders guide text: **bold** for buttons and fields, [label](/path) for links. */
export function HelpText({ t }: { t: string }) {
  const out: React.ReactNode[] = [];
  const re = /\*\*([^*]+)\*\*|\[([^\]]+)\]\(([^)]+)\)/g;
  let last = 0, m: RegExpExecArray | null, k = 0;
  while ((m = re.exec(t))) {
    if (m.index > last) out.push(t.slice(last, m.index));
    if (m[1]) out.push(<b key={k++} className="ui-name">{m[1]}</b>);
    else out.push(<Link key={k++} href={m[3]}>{m[2]}</Link>);
    last = m.index + m[0].length;
  }
  if (last < t.length) out.push(t.slice(last));
  return <>{out}</>;
}

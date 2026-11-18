import type { Ctx } from "@/lib/access";
import { canAnywhere, roleAt } from "@/lib/access";
import { seesPayroll } from "@/lib/services/payroll";
import { visibleReports } from "@/lib/services/reports";
import { FRONT } from "./topics-front";
import { BACK } from "./topics-back";
import { FLOWS } from "./flows";
import { GROUPS, type HelpAccess, type HelpTopic, type HelpFlow } from "./types";

export { GROUPS, FLOWS };
export type { HelpTopic, HelpFlow };
export const TOPICS: HelpTopic[] = [...FRONT, ...BACK];
export const topicBySlug = (s: string) => TOPICS.find((t) => t.slug === s);
export const flowBySlug = (s: string) => FLOWS.find((f) => f.slug === s);

export function accessChecker(ctx: Ctx) {
  const has = (a: HelpAccess): boolean => {
    switch (a) {
      case "all": return true;
      case "technician": return roleAt(ctx, ctx.currentBranchId)?.roleCode === "technician" || ctx.grants.some((g) => g.roleCode === "technician");
      case "payroll": return seesPayroll(ctx);
      case "reports": return visibleReports(ctx).length > 0;
      default: return canAnywhere(ctx, a, "view");
    }
  };
  return (x: { access: HelpAccess[] }) => x.access.some(has);
}

/** Plain text of a topic, for the search box. */
export function topicText(t: HelpTopic) {
  return [t.title, t.summary, t.who, ...t.parts.flatMap((p) => [p.h, p.intro ?? "", ...(p.steps ?? []), ...(p.tips ?? [])])].join(" ").replace(/\*\*|\[|\]\([^)]*\)/g, "");
}

export { topicForPath } from "./screens";

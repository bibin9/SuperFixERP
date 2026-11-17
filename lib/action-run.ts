import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { AppError } from "./errors";

export const obj = (fd: FormData) => Object.fromEntries([...fd.entries()].filter(([k, v]) => !k.startsWith("$") && typeof v === "string").map(([k, v]) => [k, String(v)]));
export const withQ = (target: string, key: string, msg: string) => {
  const [path, hash] = target.split("#");
  return `${path}${path.includes("?") ? "&" : "?"}${key}=${encodeURIComponent(msg)}${hash ? `#${hash}` : ""}`;
};
/** Values of fields named prefix[key] as { key: value }. */
export const keyed = (fd: FormData, prefix: string) =>
  Object.fromEntries([...fd.entries()].filter(([k]) => k.startsWith(prefix + "[")).map(([k, v]) => [k.slice(prefix.length + 1, -1), String(v)]));

/** Runs a mutation; business errors come back to the same page as a message, never as a crash. */
export async function run(back: string, fn: () => Promise<string | void>, okMsg?: string): Promise<never> {
  let target: string;
  try {
    const r = await fn();
    target = typeof r === "string" ? r : okMsg ? withQ(back, "ok", okMsg) : back;
  } catch (e) {
    if (e instanceof AppError) {
      target = withQ(back, "err", e.message);
      const field = (e.details as { field?: string } | undefined)?.field;
      if (field) target = withQ(target, "errf", field);
    }
    else if (e instanceof Error && /must be|allows at most|cannot exceed|at least|at most/.test(e.message)) target = withQ(back, "err", e.message);
    else throw e;
  }
  revalidatePath("/", "layout");
  redirect(target);
}

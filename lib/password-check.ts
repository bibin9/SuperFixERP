import path from "node:path";
import { Worker } from "node:worker_threads";
import bcrypt from "bcryptjs";

/**
 * SEC-02: bcrypt takes about 80 ms of CPU. Done on the main thread, a burst of sign-ins (or a guessing attack)
 * froze every other user's pages, so the check runs in a small pool of worker threads instead.
 * If the workers cannot start, it falls back to the async check in this thread.
 */
type Job = { resolve: (ok: boolean) => void };
const SIZE = Math.max(1, Number(process.env.PASSWORD_WORKERS) || 2);
const g = globalThis as unknown as { __sfPw?: { workers: Worker[]; next: number; seq: number; jobs: Map<number, Job> } | null };

function pool() {
  if (g.__sfPw !== undefined) return g.__sfPw;
  try {
    const file = path.join(process.cwd(), "workers", "bcrypt-worker.cjs");
    const jobs = new Map<number, Job>();
    const workers = Array.from({ length: SIZE }, () => {
      const w = new Worker(file);
      w.on("message", (m: { id: number; ok: boolean }) => { jobs.get(m.id)?.resolve(m.ok); jobs.delete(m.id); });
      w.on("error", () => { g.__sfPw = null; for (const j of jobs.values()) j.resolve(false); jobs.clear(); });
      w.unref();
      return w;
    });
    g.__sfPw = { workers, next: 0, seq: 0, jobs };
  } catch {
    g.__sfPw = null;
  }
  return g.__sfPw;
}

export async function checkPassword(password: string, hash: string): Promise<boolean> {
  const p = pool();
  if (!p) return bcrypt.compare(password, hash);
  const id = ++p.seq;
  return new Promise<boolean>((resolve) => {
    p.jobs.set(id, { resolve });
    p.workers[p.next++ % p.workers.length].postMessage({ id, password, hash });
  });
}

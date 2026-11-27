export type ErrorCode = "unauthenticated" | "forbidden" | "not_found" | "validation" | "conflict";

export class AppError extends Error {
  /** SEC-04: a refusal that reaches a page unhandled answers 403 (and a missing record 404), not 500. */
  digest?: string;
  constructor(public code: ErrorCode, message: string, public details?: unknown) {
    super(message);
    if (code === "forbidden") this.digest = "NEXT_HTTP_ERROR_FALLBACK;403";
    if (code === "not_found") this.digest = "NEXT_HTTP_ERROR_FALLBACK;404";
  }
}

export const forbidden = (msg = "You do not have permission for this action.") => new AppError("forbidden", msg);
export const notFound = (what = "Record") => new AppError("not_found", `${what} not found.`);
export const invalid = (msg: string, details?: unknown) => new AppError("validation", msg, details);
export const conflict = (msg = "Someone else changed this record. Reload to see their change.") => new AppError("conflict", msg);

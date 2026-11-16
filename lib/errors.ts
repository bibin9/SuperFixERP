export type ErrorCode = "unauthenticated" | "forbidden" | "not_found" | "validation" | "conflict";

export class AppError extends Error {
  constructor(public code: ErrorCode, message: string, public details?: unknown) {
    super(message);
  }
}

export const forbidden = (msg = "You do not have permission for this action.") => new AppError("forbidden", msg);
export const notFound = (what = "Record") => new AppError("not_found", `${what} not found.`);
export const invalid = (msg: string, details?: unknown) => new AppError("validation", msg, details);
export const conflict = (msg = "Someone else changed this record. Reload to see their change.") => new AppError("conflict", msg);

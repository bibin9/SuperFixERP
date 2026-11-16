"use client";
export default function Error({ error }: { error: Error & { digest?: string } }) {
  return (
    <div className="card">
      <h2>This page could not be shown</h2>
      <p>{process.env.NODE_ENV === "development" ? error.message : "You may not have access to this record, or it does not exist in your branches."}</p>
      <a className="btn ghost" href="/">Back to home</a>
    </div>
  );
}

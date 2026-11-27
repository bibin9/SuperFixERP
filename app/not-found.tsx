/** SEC-04: shown with HTTP 404 for a missing record, or one in a branch the user cannot see (it is not revealed which). */
export default function NotFound() {
  return (
    <main className="public" style={{ maxWidth: 520, marginTop: 80 }}>
      <div className="card">
        <h1>This page could not be shown</h1>
        <p>You may not have access to this record, or it does not exist in your branches.</p>
        <p><a className="btn ghost" href="/">Back to home</a></p>
      </div>
    </main>
  );
}

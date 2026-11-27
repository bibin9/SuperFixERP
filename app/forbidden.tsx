/** SEC-04: shown with HTTP 403 when a page is refused (another branch's record, or a screen the role cannot use). */
export default function Forbidden() {
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

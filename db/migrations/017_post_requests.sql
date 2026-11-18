-- 017 Posting requests (Codex concurrent-posting report: CONC-01, CONC-03, CONC-04).
-- Every posting form carries a request key made when the form is shown. The first request with a key
-- claims it here, inside the same transaction as the posting, together with a hash of what was asked
-- (who, which document, which lines, which amount). A second request with the same key waits for the
-- first to finish, then gets the first result back; the same key with a different request is refused.
-- If the first request fails, its claim rolls back with it and the retry posts normally.
CREATE TABLE post_request (
  request_key text PRIMARY KEY CHECK (length(request_key) BETWEEN 16 AND 100),
  kind text NOT NULL,
  request_hash text NOT NULL,
  user_id uuid NOT NULL REFERENCES app_user(id),
  result jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX post_request_created_idx ON post_request (created_at);

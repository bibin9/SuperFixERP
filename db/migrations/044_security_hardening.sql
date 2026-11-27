-- Security test fixes (27 Nov 2026).
-- SEC-05: limits on the public forms are counted in the database, so they hold across restarts and
-- when UAT or production runs more than one app server.
CREATE TABLE IF NOT EXISTS rate_hit (
  bucket text NOT NULL,
  key text NOT NULL,
  at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS rate_hit_bucket_key_at ON rate_hit (bucket, key, at);

-- SEC-03 and SEC-07: new security settings, editable in Admin, Settings.
INSERT INTO setting (key, value, grp, description) VALUES
 ('security.max_failed_logins_all_networks', '25', 'Security', 'Failed sign-ins from all networks together before the whole account locks'),
 ('security.session_max_hours', '12', 'Security', 'A session ends this many hours after sign-in, even when in use')
ON CONFLICT DO NOTHING;
UPDATE setting SET description = 'Failed sign-ins from one network before the user is locked on that network'
 WHERE key = 'security.max_failed_logins' AND branch_id IS NULL;

-- Lookups for the per-network lock-out.
CREATE INDEX IF NOT EXISTS login_event_user_ip_at ON login_event (user_id, ip, at);

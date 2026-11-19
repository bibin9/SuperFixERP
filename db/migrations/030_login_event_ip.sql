-- Sign-in throttling looks up recent failures by network address (PEN-03).
CREATE INDEX IF NOT EXISTS login_event_ip_at ON login_event (ip, at) WHERE event = 'login_failed';

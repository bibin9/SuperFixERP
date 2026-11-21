-- Assigned work nobody has clocked in on: after this many minutes it is raised in the bell for advisors and the foreman.
INSERT INTO setting (key, value, grp, description)
SELECT 'workshop.start_alert_minutes', '30', 'Workshop', 'Assigned work not clocked in after this many minutes is raised in the bell for the advisor and foreman'
WHERE NOT EXISTS (SELECT 1 FROM setting WHERE key = 'workshop.start_alert_minutes' AND branch_id IS NULL);

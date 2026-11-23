-- 040 WF-07: reminders and escalation. Each step can set after how many hours a waiting approval is
-- flagged to its approvers (reminder) and after how many hours it is also offered to a higher role
-- (escalation). Steps without their own hours use the company settings. 0 switches it off.
ALTER TABLE workflow_step ADD COLUMN escalate_role_id uuid REFERENCES role(id);
ALTER TABLE approval_task ADD COLUMN remind_after timestamptz, ADD COLUMN escalate_after timestamptz, ADD COLUMN escalate_role_id uuid REFERENCES role(id);
INSERT INTO setting (key, value, grp, description)
SELECT v.key, to_jsonb(v.val), 'Approvals', v.description FROM (VALUES
  ('approvals.reminder_hours', '24', 'An approval waiting this many hours is flagged in the approvers'' bell (0 = off). A step can set its own'),
  ('approvals.escalate_hours', '48', 'An approval waiting this many hours is also offered to the escalation role (0 = off). A step can set its own'),
  ('approvals.escalate_role', 'owner', 'Role code that escalated approvals go to when the step does not name one')
) v(key, val, description)
WHERE NOT EXISTS (SELECT 1 FROM setting s WHERE s.key = v.key AND s.branch_id IS NULL);
UPDATE setting SET value = to_jsonb(24) WHERE key = 'approvals.reminder_hours' AND branch_id IS NULL AND value = '"24"';
UPDATE setting SET value = to_jsonb(48) WHERE key = 'approvals.escalate_hours' AND branch_id IS NULL AND value = '"48"';

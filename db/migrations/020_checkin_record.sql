-- 020 Check-in record on the job card (demo check-in step): damage marked on a car diagram, photos
-- (attachments with entity 'job_checkin', label in file_name) and the customer's signature.
ALTER TABLE job_card
  ADD COLUMN damage_marks jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN checkin_signature text CHECK (checkin_signature IS NULL OR length(checkin_signature) <= 400000),
  ADD COLUMN checkin_signed_name text,
  ADD COLUMN checkin_signed_at timestamptz;
CREATE INDEX attachment_entity_idx ON attachment (entity, entity_id);

-- FSD v0.10 change 1: the job card is created only after enquiry, quotation and customer approval.
--   Work lines and quotations belong to the enquiry. A job card is made from an approved quotation,
--   and the database refuses any other job card.
-- FSD v0.10 change 2: customer messaging and payment requests are manual only. No automatic sending.

-- ---------- enquiry carries the vehicle check-in and the quote stage ----------
ALTER TABLE enquiry
  ADD COLUMN odometer_in int CHECK (odometer_in >= 0),
  ADD COLUMN fuel_level int CHECK (fuel_level BETWEEN 0 AND 8),
  ADD COLUMN complaints text,
  ADD COLUMN valuables text,
  ADD COLUMN approved_at timestamptz;
ALTER TABLE enquiry DROP CONSTRAINT enquiry_status_check;
ALTER TABLE enquiry ADD CONSTRAINT enquiry_status_check
  CHECK (status IN ('open','booked','quoted','approved','converted','lost'));

-- Older job cards made before this rule get a placeholder enquiry so every job keeps one parent.
INSERT INTO enquiry (branch_id, doc_no, doc_date, customer_id, vehicle_id, service_asked, source, status, converted_job_id, notes, created_at)
SELECT j.branch_id, 'LEGACY-' || j.doc_no, j.doc_date, j.customer_id, j.vehicle_id, 'Job card ' || j.doc_no, 'other', 'converted', j.id,
       'Created by migration 005 for a job card made before the quote-first rule', j.created_at
  FROM job_card j WHERE j.enquiry_id IS NULL;
UPDATE job_card j SET enquiry_id = e.id FROM enquiry e WHERE j.enquiry_id IS NULL AND e.converted_job_id = j.id;

-- ---------- work lines: owned by the enquiry, attached to the job card when it is created ----------
ALTER TABLE job_line ADD COLUMN enquiry_id uuid REFERENCES enquiry(id);
UPDATE job_line l SET enquiry_id = j.enquiry_id FROM job_card j WHERE j.id = l.job_card_id;
ALTER TABLE job_line ALTER COLUMN enquiry_id SET NOT NULL;
ALTER TABLE job_line ALTER COLUMN job_card_id DROP NOT NULL;
CREATE UNIQUE INDEX job_line_enquiry_line_no ON job_line (enquiry_id, line_no);
COMMENT ON TABLE job_line IS 'Work lines. Created on the enquiry for the quotation; job_card_id is set when the job card is created from the approved quotation.';

-- ---------- quotations: one revision series per enquiry ----------
ALTER TABLE quotation ADD COLUMN enquiry_id uuid REFERENCES enquiry(id);
UPDATE quotation q SET enquiry_id = j.enquiry_id FROM job_card j WHERE j.id = q.job_card_id;
ALTER TABLE quotation ALTER COLUMN enquiry_id SET NOT NULL;
ALTER TABLE quotation ALTER COLUMN job_card_id DROP NOT NULL;
ALTER TABLE quotation DROP CONSTRAINT quotation_job_card_id_revision_key;
ALTER TABLE quotation ADD CONSTRAINT quotation_enquiry_revision_key UNIQUE (enquiry_id, revision);

-- ---------- deferred work can come from a quotation before any job card exists ----------
ALTER TABLE deferred_work ADD COLUMN enquiry_id uuid REFERENCES enquiry(id);
UPDATE deferred_work d SET enquiry_id = j.enquiry_id FROM job_card j WHERE j.id = d.job_card_id;
ALTER TABLE deferred_work ALTER COLUMN job_card_id DROP NOT NULL;

-- ---------- job card: only from an approved quotation ----------
ALTER TABLE job_card ADD COLUMN source_quotation_id uuid REFERENCES quotation(id);
UPDATE job_card j SET source_quotation_id = (
  SELECT q.id FROM quotation q WHERE q.job_card_id = j.id AND q.status IN ('approved','partly_approved') ORDER BY q.revision LIMIT 1);
CREATE UNIQUE INDEX job_card_one_per_enquiry ON job_card (enquiry_id);
-- Booked, checked in, inspection and awaiting approval are enquiry stages now. A job card starts at Approved.
ALTER TABLE job_card DROP CONSTRAINT job_card_status_check;
ALTER TABLE job_card ADD CONSTRAINT job_card_status_check
  CHECK (status IN ('approved','awaiting_parts','in_progress','quality_check','ready','delivered','invoiced','closed','cancelled')) NOT VALID;
ALTER TABLE job_card ALTER COLUMN status SET DEFAULT 'approved';

CREATE FUNCTION job_card_requires_approved_quote() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.enquiry_id IS DISTINCT FROM OLD.enquiry_id OR NEW.source_quotation_id IS DISTINCT FROM OLD.source_quotation_id THEN
      RAISE EXCEPTION 'The enquiry and quotation of a job card cannot be changed' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.enquiry_id IS NULL OR NEW.source_quotation_id IS NULL OR NOT EXISTS (
       SELECT 1 FROM quotation q
        WHERE q.id = NEW.source_quotation_id AND q.enquiry_id = NEW.enquiry_id AND q.branch_id = NEW.branch_id
          AND q.status IN ('approved','partly_approved')) THEN
    RAISE EXCEPTION 'A job card can only be created from a quotation the customer approved' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER job_card_quote_first BEFORE INSERT OR UPDATE ON job_card
  FOR EACH ROW EXECUTE FUNCTION job_card_requires_approved_quote();

-- ---------- messaging: manual only ----------
UPDATE branch SET whatsapp_mode = 'manual' WHERE whatsapp_mode <> 'manual';
ALTER TABLE branch DROP CONSTRAINT branch_whatsapp_mode_check;
ALTER TABLE branch ADD CONSTRAINT branch_whatsapp_mode_check CHECK (whatsapp_mode = 'manual');

ALTER TABLE message_log ADD COLUMN enquiry_id uuid REFERENCES enquiry(id);
ALTER TABLE message_log ADD COLUMN to_mobile text;
ALTER TABLE message_log ADD COLUMN confirmed_at timestamptz;
ALTER TABLE message_log ADD COLUMN confirmed_by uuid REFERENCES app_user(id);
UPDATE message_log SET status = 'prepared' WHERE status = 'button_used';
ALTER TABLE message_log ALTER COLUMN status SET DEFAULT 'prepared';
ALTER TABLE message_log ADD CONSTRAINT message_log_manual_only CHECK (mode = 'manual');
ALTER TABLE message_log ADD CONSTRAINT message_log_status_check CHECK (status IN ('prepared','sent_manually'));
ALTER TABLE message_log ADD CONSTRAINT message_log_confirmed CHECK (status <> 'sent_manually' OR (confirmed_at IS NOT NULL AND confirmed_by IS NOT NULL));

UPDATE setting SET value = '"manual"', description = 'Payments are recorded by staff. No payment gateway or payment link is called (manual only, FSD v0.10)'
 WHERE key = 'payments.gateway';

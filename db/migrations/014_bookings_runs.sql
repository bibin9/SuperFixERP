-- 014 Booking calendar with bay and technician load, and vehicle runs (recovery, towing, pickup, drop-off).

-- 1. Capacity. Each bay has hours a day (Bays master); each technician has hours a day (Technician capacity master,
--    falling back to the workshop.technician_day_hours setting).
ALTER TABLE bay ADD COLUMN capacity_hours numeric(5,2) NOT NULL DEFAULT 9 CHECK (capacity_hours > 0 AND capacity_hours <= 24);
CREATE TABLE technician_capacity (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES app_user(id),
  daily_hours numeric(5,2) NOT NULL CHECK (daily_hours > 0 AND daily_hours <= 24),
  note text,
  active boolean NOT NULL DEFAULT true
);

-- 2. A booking is held on the enquiry: when the car comes, which bay, which technician and for how many hours.
ALTER TABLE enquiry
  ADD COLUMN booked_for timestamptz,
  ADD COLUMN booking_bay_id uuid REFERENCES bay(id),
  ADD COLUMN booking_technician_id uuid REFERENCES app_user(id),
  ADD COLUMN booking_hours numeric(5,2) CHECK (booking_hours IS NULL OR (booking_hours > 0 AND booking_hours <= 24)),
  ADD COLUMN booking_status text CHECK (booking_status IN ('booked','checked_in','no_show','cancelled')),
  ADD COLUMN booking_override_reason text,
  ADD COLUMN booked_by uuid REFERENCES app_user(id),
  ADD COLUMN booked_at timestamptz,
  ADD CONSTRAINT enquiry_booking_complete CHECK (booking_status IS NULL OR (booked_for IS NOT NULL AND booking_hours IS NOT NULL));
CREATE INDEX enquiry_booked_for_idx ON enquiry (branch_id, booked_for) WHERE booking_status = 'booked';

-- 3. Vehicle runs: the driver's recovery, towing, pickup and drop-off trips, each from one place to another.
CREATE TABLE vehicle_run (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES branch(id),
  doc_no text NOT NULL UNIQUE,
  run_type text NOT NULL CHECK (run_type IN ('recovery','towing','pickup','drop_off')),
  enquiry_id uuid REFERENCES enquiry(id),
  job_card_id uuid REFERENCES job_card(id),
  vehicle_id uuid REFERENCES vehicle(id),
  driver_user_id uuid REFERENCES app_user(id),
  driver_name text,
  recovery_vehicle text,
  from_location text NOT NULL,
  to_location text NOT NULL,
  scheduled_at timestamptz NOT NULL,
  started_at timestamptz,
  completed_at timestamptz,
  distance_km numeric(8,1) CHECK (distance_km IS NULL OR distance_km >= 0),
  charge numeric(14,2) CHECK (charge IS NULL OR charge >= 0),
  status text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','on_the_way','completed','cancelled')),
  cancel_reason text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  version int NOT NULL DEFAULT 1,
  CHECK (driver_user_id IS NOT NULL OR driver_name IS NOT NULL),
  CHECK (status <> 'cancelled' OR cancel_reason IS NOT NULL),
  CHECK (completed_at IS NULL OR started_at IS NULL OR completed_at >= started_at)
);
CREATE INDEX vehicle_run_driver_idx ON vehicle_run (driver_user_id, scheduled_at);
CREATE INDEX vehicle_run_branch_idx ON vehicle_run (branch_id, scheduled_at);
ALTER TABLE vehicle_run ENABLE ROW LEVEL SECURITY;
CREATE POLICY branch_scope ON vehicle_run USING (app_branch_ok(branch_id)) WITH CHECK (app_branch_ok(branch_id));

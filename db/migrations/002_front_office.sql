-- 002 Front office (FSD phase 1): M02 customers, vehicles, enquiries; M03 job cards;
-- M04 quotations and customer approval; M15 manual WhatsApp templates and log.

CREATE TABLE country (
  code char(2) PRIMARY KEY,
  name text NOT NULL,
  dial_code text NOT NULL,
  mobile_regex text NOT NULL,
  id_types text[] NOT NULL
);

CREATE TABLE customer_title (
  code text PRIMARY KEY,
  name_en text NOT NULL,
  name_ar text,
  active boolean NOT NULL DEFAULT true
);

-- Customers and vehicles are shared by every branch (CV-12): no row security.
CREATE SEQUENCE customer_no_seq START 1001;
CREATE TABLE customer (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_no text NOT NULL UNIQUE DEFAULT ('C' || nextval('customer_no_seq')),
  customer_type text NOT NULL CHECK (customer_type IN ('individual','corporate','government')),
  title text REFERENCES customer_title(code),
  first_name text,
  last_name text,
  company_name text,
  name_ar text,
  country_code char(2) NOT NULL REFERENCES country(code),
  mobile text NOT NULL CHECK (mobile ~ '^\+[0-9]{8,15}$'),
  whatsapp boolean NOT NULL DEFAULT true,
  alt_phone text,
  email text,
  id_type text,
  id_number text,
  nationality text,
  preferred_branch_id uuid REFERENCES branch(id),
  price_level text NOT NULL DEFAULT 'retail' CHECK (price_level IN ('retail','trade','fleet')),
  marketing_consent boolean NOT NULL DEFAULT false,
  consent_at timestamptz,
  consent_channel text,
  preferred_channel text NOT NULL DEFAULT 'whatsapp' CHECK (preferred_channel IN ('whatsapp','sms','email','phone')),
  trn char(15) CHECK (trn ~ '^[0-9]{15}$'),
  address text,
  credit_limit numeric(14,2) NOT NULL DEFAULT 0 CHECK (credit_limit >= 0),
  payment_terms_days int NOT NULL DEFAULT 0 CHECK (payment_terms_days >= 0),
  fleet_discount_pct numeric(9,4) NOT NULL DEFAULT 0 CHECK (fleet_discount_pct BETWEEN 0 AND 100),
  lpo_required boolean NOT NULL DEFAULT false,
  consolidated_invoice boolean NOT NULL DEFAULT false,
  duplicate_reason text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  version int NOT NULL DEFAULT 1,
  -- CV-02: title required for individuals; company name for companies
  CHECK (customer_type <> 'individual' OR (title IS NOT NULL AND first_name IS NOT NULL)),
  CHECK (customer_type = 'individual' OR company_name IS NOT NULL)
);
CREATE INDEX customer_mobile_idx ON customer (mobile);

CREATE TABLE customer_contact (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES customer(id) ON DELETE CASCADE,
  title text REFERENCES customer_title(code),
  name text NOT NULL,
  mobile text,
  role text
);

CREATE TABLE consent_log (
  id bigserial PRIMARY KEY,
  customer_id uuid NOT NULL REFERENCES customer(id),
  consent boolean NOT NULL,
  channel text NOT NULL,
  at timestamptz NOT NULL DEFAULT now(),
  user_id uuid
);
CREATE TRIGGER consent_log_append_only BEFORE UPDATE OR DELETE ON consent_log FOR EACH ROW EXECUTE FUNCTION forbid_change();

-- Plate set-up per emirate or GCC country (CV-11)
CREATE TABLE plate_template (
  code text PRIMARY KEY,
  name text NOT NULL,
  country_code char(2) NOT NULL REFERENCES country(code),
  code_label text,
  code_values text[],
  number_regex text NOT NULL DEFAULT '^[0-9]{1,6}$',
  active boolean NOT NULL DEFAULT true
);

CREATE TABLE vehicle (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  registered_in text NOT NULL REFERENCES plate_template(code),
  plate_code text,
  plate_number text NOT NULL,
  plate_key text GENERATED ALWAYS AS (registered_in || '|' || coalesce(upper(plate_code), '') || '|' || upper(plate_number)) STORED,
  vin text CHECK (vin ~ '^[A-HJ-NPR-Z0-9]{17}$'),
  vin_missing_reason text,
  make text NOT NULL,
  model text NOT NULL,
  model_year int CHECK (model_year BETWEEN 1950 AND 2100),
  engine text,
  fuel text,
  transmission text,
  colour text,
  mulkiya_expiry date,
  odometer int CHECK (odometer >= 0),
  service_interval_km int,
  service_interval_months int,
  owner_customer_id uuid NOT NULL REFERENCES customer(id),
  duplicate_reason text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  version int NOT NULL DEFAULT 1,
  CHECK (vin IS NOT NULL OR vin_missing_reason IS NOT NULL)
);
-- CV-08: a duplicate VIN is blocked outright
CREATE UNIQUE INDEX vehicle_vin_uq ON vehicle (vin) WHERE vin IS NOT NULL;
CREATE INDEX vehicle_plate_key_idx ON vehicle (plate_key);

CREATE TABLE vehicle_customer (
  vehicle_id uuid NOT NULL REFERENCES vehicle(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES customer(id),
  relation text NOT NULL CHECK (relation IN ('owner','driver')),
  PRIMARY KEY (vehicle_id, customer_id)
);

CREATE TABLE lookup_value (
  list text NOT NULL,
  code text NOT NULL,
  name_en text NOT NULL,
  name_ar text,
  sort int NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  PRIMARY KEY (list, code)
);

-- Service catalogue (master). Standard time copied to job lines (WS-03).
CREATE TABLE service (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name_en text NOT NULL,
  name_ar text,
  category text NOT NULL DEFAULT 'service',
  standard_hours numeric(9,4) NOT NULL DEFAULT 0 CHECK (standard_hours >= 0),
  labour_rate numeric(14,2) NOT NULL DEFAULT 0 CHECK (labour_rate >= 0),
  is_quick boolean NOT NULL DEFAULT false,
  vat_code text NOT NULL DEFAULT 'SR',
  active boolean NOT NULL DEFAULT true,
  version int NOT NULL DEFAULT 1
);

CREATE TABLE tax_code (
  code text PRIMARY KEY,
  name text NOT NULL,
  rate numeric(9,4) NOT NULL CHECK (rate >= 0),
  vat201_box text
);

-- Enquiries (CV-10)
CREATE TABLE enquiry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES branch(id),
  doc_no text NOT NULL UNIQUE,
  doc_date date NOT NULL DEFAULT (now() AT TIME ZONE 'Asia/Dubai')::date,
  customer_id uuid REFERENCES customer(id),
  vehicle_id uuid REFERENCES vehicle(id),
  contact_name text,
  contact_mobile text,
  service_asked text NOT NULL,
  source text NOT NULL,
  assigned_to uuid REFERENCES app_user(id),
  follow_up_at timestamptz,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','quoted','booked','converted','lost')),
  lost_reason text,
  notes text,
  converted_job_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  version int NOT NULL DEFAULT 1,
  CHECK (status <> 'lost' OR lost_reason IS NOT NULL)
);

CREATE TABLE job_card (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES branch(id),
  doc_no text NOT NULL UNIQUE,
  doc_date date NOT NULL DEFAULT (now() AT TIME ZONE 'Asia/Dubai')::date,
  job_type text NOT NULL DEFAULT 'service' CHECK (job_type IN ('service','repair','warranty_comeback','internal','recovery','quick')),
  customer_id uuid NOT NULL REFERENCES customer(id),
  vehicle_id uuid NOT NULL REFERENCES vehicle(id),
  enquiry_id uuid REFERENCES enquiry(id),
  original_job_id uuid REFERENCES job_card(id),
  odometer_in int CHECK (odometer_in >= 0),
  fuel_level int CHECK (fuel_level BETWEEN 0 AND 8),
  complaints text,
  valuables text,
  advisor_id uuid REFERENCES app_user(id),
  bay_id uuid REFERENCES bay(id),
  promised_at timestamptz,
  status text NOT NULL DEFAULT 'checked_in' CHECK (status IN ('booked','checked_in','inspection','awaiting_approval','approved','awaiting_parts','in_progress','quality_check','ready','delivered','invoiced','closed','cancelled')),
  lpo_no text,
  delay_reason text,
  delay_note text,
  cancel_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  version int NOT NULL DEFAULT 1,
  CHECK (job_type <> 'warranty_comeback' OR original_job_id IS NOT NULL)
);
ALTER TABLE enquiry ADD CONSTRAINT enquiry_converted_job_fk FOREIGN KEY (converted_job_id) REFERENCES job_card(id);
CREATE INDEX job_card_vehicle_idx ON job_card (vehicle_id);

CREATE TABLE job_status_history (
  id bigserial PRIMARY KEY,
  job_card_id uuid NOT NULL REFERENCES job_card(id),
  branch_id uuid NOT NULL REFERENCES branch(id),
  from_status text,
  to_status text NOT NULL,
  reason text,
  at timestamptz NOT NULL DEFAULT now(),
  user_id uuid
);

CREATE TABLE job_line (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_card_id uuid NOT NULL REFERENCES job_card(id),
  branch_id uuid NOT NULL REFERENCES branch(id),
  line_no int NOT NULL,
  line_type text NOT NULL CHECK (line_type IN ('labour','part','outside','consumable')),
  service_id uuid REFERENCES service(id),
  item_id uuid,
  description text NOT NULL,
  qty numeric(14,3) NOT NULL CHECK (qty > 0),
  standard_hours numeric(9,4),
  unit_price numeric(14,2) NOT NULL CHECK (unit_price >= 0),
  discount_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
  vat_code text NOT NULL REFERENCES tax_code(code),
  technician_id uuid REFERENCES app_user(id),
  extra_work boolean NOT NULL DEFAULT false,
  approval_status text NOT NULL DEFAULT 'pending' CHECK (approval_status IN ('pending','approved','declined','deferred')),
  below_margin boolean NOT NULL DEFAULT false,
  removed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  version int NOT NULL DEFAULT 1,
  UNIQUE (job_card_id, line_no),
  CHECK (discount_amount <= round(qty * unit_price, 2))
);

CREATE TABLE quotation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES branch(id),
  job_card_id uuid NOT NULL REFERENCES job_card(id),
  revision int NOT NULL,
  doc_no text NOT NULL UNIQUE,
  doc_date date NOT NULL DEFAULT (now() AT TIME ZONE 'Asia/Dubai')::date,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','pending_internal_approval','ready_to_send','sent','partly_approved','approved','declined','expired','superseded')),
  valid_until date NOT NULL,
  doc_discount_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (doc_discount_amount >= 0),
  gross_amount numeric(14,2) NOT NULL DEFAULT 0,
  discount_total numeric(14,2) NOT NULL DEFAULT 0,
  taxable_total numeric(14,2) NOT NULL DEFAULT 0,
  vat_total numeric(14,2) NOT NULL DEFAULT 0,
  grand_total numeric(14,2) NOT NULL DEFAULT 0,
  approved_total numeric(14,2) NOT NULL DEFAULT 0,
  needs_internal_approval boolean NOT NULL DEFAULT false,
  internal_approval_reason text,
  terms text,
  public_token text UNIQUE,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  version int NOT NULL DEFAULT 1,
  UNIQUE (job_card_id, revision)
);

CREATE TABLE quotation_line (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quotation_id uuid NOT NULL REFERENCES quotation(id),
  branch_id uuid NOT NULL REFERENCES branch(id),
  job_line_id uuid NOT NULL REFERENCES job_line(id),
  line_no int NOT NULL,
  line_type text NOT NULL,
  description text NOT NULL,
  qty numeric(14,3) NOT NULL,
  unit_price numeric(14,2) NOT NULL,
  gross_amount numeric(14,2) NOT NULL,
  line_discount numeric(14,2) NOT NULL,
  doc_discount_share numeric(14,2) NOT NULL,
  taxable_amount numeric(14,2) NOT NULL,
  vat_code text NOT NULL,
  vat_rate numeric(9,4) NOT NULL,
  vat_amount numeric(14,2) NOT NULL,
  line_total numeric(14,2) NOT NULL,
  below_margin boolean NOT NULL DEFAULT false,
  decision text NOT NULL DEFAULT 'pending' CHECK (decision IN ('pending','approved','declined')),
  decided_at timestamptz,
  decision_channel text CHECK (decision_channel IN ('whatsapp_link','in_person','phone','email')),
  decided_by uuid,
  decision_note text,
  CHECK (decision_channel IS DISTINCT FROM 'phone' OR decision_note IS NOT NULL)
);

CREATE TABLE deferred_work (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid NOT NULL REFERENCES vehicle(id),
  branch_id uuid NOT NULL REFERENCES branch(id),
  job_card_id uuid NOT NULL REFERENCES job_card(id),
  description text NOT NULL,
  follow_up_date date,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','done','dropped')),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- M15 messaging (manual mode in phase 1)
CREATE TABLE message_template (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event text NOT NULL,
  language text NOT NULL CHECK (language IN ('en','ar')),
  body text NOT NULL,
  meta_template_name text,
  active boolean NOT NULL DEFAULT true,
  UNIQUE (event, language)
);

CREATE TABLE message_log (
  id bigserial PRIMARY KEY,
  branch_id uuid NOT NULL REFERENCES branch(id),
  customer_id uuid REFERENCES customer(id),
  job_card_id uuid REFERENCES job_card(id),
  event text NOT NULL,
  channel text NOT NULL DEFAULT 'whatsapp',
  mode text NOT NULL DEFAULT 'manual',
  status text NOT NULL DEFAULT 'button_used',
  body text NOT NULL,
  at timestamptz NOT NULL DEFAULT now(),
  user_id uuid
);

-- Row security: transaction tables are branch-scoped (FSD 3.1).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['enquiry','job_card','job_status_history','job_line','quotation','quotation_line','deferred_work','message_log'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY branch_scope ON %I USING (app_branch_ok(branch_id)) WITH CHECK (app_branch_ok(branch_id))', t);
  END LOOP;
END $$;

-- BR-04 / CV-07: service history of a shared vehicle across all branches. Date, branch, job no,
-- work done and odometer are visible everywhere; amounts only for branches the caller can access.
CREATE OR REPLACE FUNCTION vehicle_history(p_vehicle uuid)
RETURNS TABLE (job_id uuid, doc_no text, doc_date date, branch_code text, status text, odometer_in int, work_done text, amount numeric, can_open boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT j.id, j.doc_no, j.doc_date, b.code, j.status, j.odometer_in,
         (SELECT string_agg(l.description, ', ' ORDER BY l.line_no) FROM job_line l WHERE l.job_card_id = j.id AND NOT l.removed AND l.approval_status = 'approved'),
         CASE WHEN app_branch_ok(j.branch_id) THEN
           (SELECT q.approved_total FROM quotation q WHERE q.job_card_id = j.id AND q.status IN ('approved','partly_approved') ORDER BY q.revision DESC LIMIT 1)
         END,
         app_branch_ok(j.branch_id)
  FROM job_card j JOIN branch b ON b.id = j.branch_id
  WHERE j.vehicle_id = p_vehicle AND app_user_id() IS NOT NULL
  ORDER BY j.doc_date DESC, j.doc_no DESC
$$;

-- Customer approval page (QT-02): resolves an unguessable token to its branch only while the
-- quotation is open for approval, so the page can run with that single branch in scope.
CREATE OR REPLACE FUNCTION quotation_branch_by_token(p_token text)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT branch_id FROM quotation
   WHERE public_token = p_token AND length(p_token) >= 32
     AND status IN ('sent','partly_approved','approved','declined')
$$;

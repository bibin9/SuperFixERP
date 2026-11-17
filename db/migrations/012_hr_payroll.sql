-- 012 HR, employee self-service and payroll (FSD 4.13, 4.14 and 5.5; phase 5).

-- ---------- masters ----------
CREATE TABLE department (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE CHECK (code ~ '^[A-Z0-9-]{2,20}$'),
  name_en text NOT NULL, name_ar text,
  head_employee_id uuid,
  active boolean NOT NULL DEFAULT true
);
CREATE TABLE designation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE CHECK (code ~ '^[A-Z0-9-]{2,20}$'),
  name_en text NOT NULL, name_ar text,
  active boolean NOT NULL DEFAULT true
);
-- WPS agents: the bank or exchange house that pays salaries (PR-03).
CREATE TABLE wps_agent (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE CHECK (code ~ '^[A-Z0-9-]{2,20}$'),
  name text NOT NULL,
  routing_code text NOT NULL CHECK (routing_code ~ '^[0-9]{9}$'),
  active boolean NOT NULL DEFAULT true
);
CREATE TABLE shift (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE CHECK (code ~ '^[A-Z0-9-]{1,20}$'),
  name text NOT NULL,
  start_time time NOT NULL, end_time time NOT NULL,
  break_minutes int NOT NULL DEFAULT 60 CHECK (break_minutes BETWEEN 0 AND 240),
  grace_minutes int NOT NULL DEFAULT 10 CHECK (grace_minutes BETWEEN 0 AND 120),
  night boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true
);
CREATE TABLE public_holiday (
  holiday_date date PRIMARY KEY,
  name text NOT NULL,
  active boolean NOT NULL DEFAULT true
);
-- Leave types with entitlement rules (HR-04). accrual 'labour_law_annual' follows FSD 5.5;
-- 'yearly' gives entitlement_days per calendar year; 'none' has no limit (unpaid).
CREATE TABLE leave_type (
  code text PRIMARY KEY CHECK (code ~ '^[a-z_]{2,30}$'),
  name_en text NOT NULL, name_ar text,
  paid boolean NOT NULL DEFAULT true,
  accrual text NOT NULL DEFAULT 'yearly' CHECK (accrual IN ('labour_law_annual','yearly','none')),
  entitlement_days numeric(6,2) NOT NULL DEFAULT 0 CHECK (entitlement_days >= 0),
  allow_negative boolean NOT NULL DEFAULT false,
  sort int NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true
);
-- Salary components (PR-09).
CREATE TABLE salary_component (
  code text PRIMARY KEY CHECK (code ~ '^[a-z_]{2,30}$'),
  name_en text NOT NULL, name_ar text,
  kind text NOT NULL CHECK (kind IN ('earning','deduction')),
  fixed boolean NOT NULL DEFAULT true,
  counts_gratuity boolean NOT NULL DEFAULT false,
  counts_leave_salary boolean NOT NULL DEFAULT false,
  counts_overtime boolean NOT NULL DEFAULT false,
  wps_column text NOT NULL DEFAULT 'fixed' CHECK (wps_column IN ('fixed','variable')),
  account_id uuid REFERENCES account(id),
  sort int NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true
);
-- Custom fields on the employee file (HR-06).
CREATE TABLE custom_field (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE CHECK (code ~ '^[a-z_]{2,30}$'),
  label text NOT NULL,
  field_type text NOT NULL CHECK (field_type IN ('text','number','date','dropdown','yes_no','attachment')),
  options text,
  required boolean NOT NULL DEFAULT false,
  tab text NOT NULL DEFAULT 'personal' CHECK (tab IN ('personal','job','documents','other')),
  hidden_roles text NOT NULL DEFAULT '',
  sort int NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true
);
CREATE TABLE letter_template (
  code text PRIMARY KEY CHECK (code ~ '^[a-z_]{2,30}$'),
  name_en text NOT NULL,
  body_en text NOT NULL,
  body_ar text,
  shows_salary boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true
);
CREATE TABLE checklist_template (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('joining','leaving')),
  item text NOT NULL,
  sort int NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true
);

-- Branch location for mobile check-in (HR-11).
ALTER TABLE branch ADD COLUMN latitude numeric(9,6), ADD COLUMN longitude numeric(9,6),
  ADD COLUMN qr_secret text NOT NULL DEFAULT encode(gen_random_bytes(16), 'hex');

-- ---------- employee file (HR-01, HR-14) ----------
CREATE TABLE employee (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES branch(id),
  emp_no text NOT NULL UNIQUE,
  user_id uuid UNIQUE REFERENCES app_user(id),
  first_name text NOT NULL, last_name text NOT NULL, name_ar text,
  nationality text NOT NULL REFERENCES country(code),
  date_of_birth date, gender text CHECK (gender IN ('male','female')),
  marital_status text CHECK (marital_status IN ('single','married','divorced','widowed')),
  mobile text, email text, emergency_contact text,
  department_id uuid REFERENCES department(id),
  designation_id uuid REFERENCES designation(id),
  grade text,
  line_manager_id uuid REFERENCES employee(id),
  joining_date date NOT NULL,
  contract_type text NOT NULL DEFAULT 'limited' CHECK (contract_type IN ('limited','unlimited','part_time','temporary')),
  contract_end date,
  probation_end date,
  mohre_person_code text CHECK (mohre_person_code IS NULL OR mohre_person_code ~ '^[0-9]{14}$'),
  labour_card_no text,
  wps_agent_id uuid REFERENCES wps_agent(id),
  pay_method text NOT NULL DEFAULT 'iban' CHECK (pay_method IN ('iban','wps_card')),
  iban text CHECK (iban IS NULL OR iban ~ '^AE[0-9]{21}$'),
  wps_card_no text,
  shift_id uuid REFERENCES shift(id),
  weekly_off int NOT NULL DEFAULT 5 CHECK (weekly_off BETWEEN 0 AND 6),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','left')),
  leaving_date date, leaving_reason text,
  custom jsonb NOT NULL DEFAULT '{}',
  created_by uuid, created_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid, updated_at timestamptz NOT NULL DEFAULT now(),
  version int NOT NULL DEFAULT 1,
  CHECK (line_manager_id IS NULL OR line_manager_id <> id),
  CHECK (contract_end IS NULL OR contract_end >= joining_date)
);
CREATE INDEX employee_branch ON employee (branch_id, status);
ALTER TABLE department ADD CONSTRAINT department_head FOREIGN KEY (head_employee_id) REFERENCES employee(id);

-- Records kept on the employee file: documents (HR-02), insurance (HR-07), air ticket (HR-08),
-- visa process (HR-16), assets issued (HR-17), disciplinary (HR-18), performance (HR-19), training (HR-20).
-- Fields per kind are declared in lib/services/hr-records.ts; expiry is kept in its own column for alerts.
CREATE TABLE employee_record (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES branch(id),
  employee_id uuid NOT NULL REFERENCES employee(id),
  kind text NOT NULL CHECK (kind IN ('document','insurance','air_ticket','visa','asset','disciplinary','review','training')),
  data jsonb NOT NULL DEFAULT '{}',
  expiry_date date,
  amount numeric(14,2),
  deduct_month date,
  attachment_id uuid REFERENCES attachment(id),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','closed')),
  created_by uuid, created_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX employee_record_emp ON employee_record (employee_id, kind);
CREATE INDEX employee_record_expiry ON employee_record (expiry_date) WHERE expiry_date IS NOT NULL AND status = 'active';

-- Joining and leaving checklists (HR-15).
CREATE TABLE employee_checklist (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES branch(id),
  employee_id uuid NOT NULL REFERENCES employee(id),
  kind text NOT NULL CHECK (kind IN ('joining','leaving')),
  item text NOT NULL, sort int NOT NULL DEFAULT 0,
  done boolean NOT NULL DEFAULT false, done_by uuid, done_at timestamptz, note text
);

-- Branch transfers (HR-05): the history drives attendance branch and the payroll split.
CREATE TABLE staff_transfer (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES branch(id),      -- the receiving branch
  employee_id uuid NOT NULL REFERENCES employee(id),
  from_branch_id uuid NOT NULL REFERENCES branch(id),
  to_branch_id uuid NOT NULL REFERENCES branch(id),
  effective_date date NOT NULL,
  reason text,
  applied boolean NOT NULL DEFAULT false,
  created_by uuid, created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (from_branch_id <> to_branch_id),
  UNIQUE (employee_id, effective_date)
);

-- ---------- attendance (HR-03, HR-11, HR-12) ----------
CREATE TABLE punch (
  id bigserial PRIMARY KEY,
  branch_id uuid NOT NULL REFERENCES branch(id),
  employee_id uuid NOT NULL REFERENCES employee(id),
  at timestamptz NOT NULL,
  source text NOT NULL CHECK (source IN ('device','gps','qr','manual')),
  device_ref text,
  latitude numeric(9,6), longitude numeric(9,6), distance_m int,
  note text,
  created_by uuid, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (employee_id, at)
);
CREATE INDEX punch_day ON punch (employee_id, at);
CREATE TABLE roster_day (
  branch_id uuid NOT NULL REFERENCES branch(id),
  employee_id uuid NOT NULL REFERENCES employee(id),
  work_date date NOT NULL,
  shift_id uuid REFERENCES shift(id),          -- NULL = day off
  PRIMARY KEY (employee_id, work_date)
);

-- ---------- requests from staff and managers ----------
CREATE TABLE leave_request (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES branch(id),
  doc_no text UNIQUE,
  employee_id uuid NOT NULL REFERENCES employee(id),
  leave_type text NOT NULL REFERENCES leave_type(code),
  from_date date NOT NULL, to_date date NOT NULL,
  days numeric(6,2) NOT NULL CHECK (days > 0),
  reason text,
  status text NOT NULL DEFAULT 'pending_approval' CHECK (status IN ('pending_approval','approved','rejected','cancelled')),
  reject_reason text,
  created_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), decided_at timestamptz,
  CHECK (to_date >= from_date)
);
CREATE INDEX leave_request_emp ON leave_request (employee_id, from_date);
-- Opening balances carried from Tally, encashment and manual corrections (signed days).
CREATE TABLE leave_adjustment (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES branch(id),
  employee_id uuid NOT NULL REFERENCES employee(id),
  leave_type text NOT NULL REFERENCES leave_type(code),
  adj_date date NOT NULL,
  days numeric(6,2) NOT NULL CHECK (days <> 0),
  reason text NOT NULL,
  created_by uuid, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE overtime_request (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES branch(id),
  employee_id uuid NOT NULL REFERENCES employee(id),
  work_date date NOT NULL,
  hours numeric(5,2) NOT NULL CHECK (hours > 0 AND hours <= 12),
  ot_type text NOT NULL CHECK (ot_type IN ('normal','night','rest_day','holiday')),
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'pending_approval' CHECK (status IN ('pending_approval','approved','rejected')),
  reject_reason text,
  payroll_run_id uuid,
  created_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE hr_letter (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES branch(id),
  ref_no text UNIQUE,
  employee_id uuid NOT NULL REFERENCES employee(id),
  template_code text NOT NULL REFERENCES letter_template(code),
  language text NOT NULL DEFAULT 'en' CHECK (language IN ('en','ar')),
  addressed_to text,
  body text,
  status text NOT NULL DEFAULT 'pending_approval' CHECK (status IN ('pending_approval','approved','rejected')),
  reject_reason text,
  created_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), approved_at timestamptz
);

-- ---------- payroll (PR-01 to PR-15) ----------
CREATE TABLE salary_structure (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES branch(id),
  employee_id uuid NOT NULL REFERENCES employee(id),
  component text NOT NULL REFERENCES salary_component(code),
  amount numeric(14,2) NOT NULL CHECK (amount >= 0),
  effective_from date NOT NULL,
  revision_id uuid,
  created_by uuid, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (employee_id, component, effective_from)
);
CREATE TABLE salary_revision (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES branch(id),
  doc_no text UNIQUE,
  effective_date date NOT NULL,
  reason text NOT NULL,
  lines jsonb NOT NULL,          -- [{employee_id, emp_no, name, component, old, new}]
  total_change numeric(14,2) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending_approval' CHECK (status IN ('pending_approval','approved','rejected')),
  reject_reason text,
  created_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), decided_at timestamptz
);
ALTER TABLE salary_structure ADD CONSTRAINT ss_revision FOREIGN KEY (revision_id) REFERENCES salary_revision(id);
CREATE TABLE loan (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES branch(id),
  doc_no text UNIQUE,
  employee_id uuid NOT NULL REFERENCES employee(id),
  kind text NOT NULL CHECK (kind IN ('advance','loan')),
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  instalments int NOT NULL CHECK (instalments BETWEEN 1 AND 60),
  instalment_amount numeric(14,2) NOT NULL CHECK (instalment_amount > 0),
  start_month date NOT NULL CHECK (extract(day FROM start_month) = 1),
  reason text NOT NULL,
  recovered numeric(14,2) NOT NULL DEFAULT 0 CHECK (recovered >= 0),
  status text NOT NULL DEFAULT 'pending_approval' CHECK (status IN ('pending_approval','approved','rejected','closed')),
  bank_account_id uuid REFERENCES bank_account(id),
  journal_id uuid REFERENCES journal(id),
  reject_reason text,
  created_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), decided_at timestamptz,
  CHECK (recovered <= amount)
);
CREATE TABLE payroll_run (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  period_month date NOT NULL UNIQUE CHECK (extract(day FROM period_month) = 1),
  status text NOT NULL DEFAULT 'calculated' CHECK (status IN ('calculated','pending_approval','approved','posted','wps_created','paid')),
  employees int NOT NULL DEFAULT 0,
  gross numeric(14,2) NOT NULL DEFAULT 0, deductions numeric(14,2) NOT NULL DEFAULT 0, net numeric(14,2) NOT NULL DEFAULT 0,
  calculated_by uuid, calculated_at timestamptz,
  approved_at timestamptz,
  posted_by uuid, posted_at timestamptz, journal_ids uuid[],
  paid_by uuid, paid_at timestamptz, bank_account_id uuid REFERENCES bank_account(id),
  reopened_by uuid, reopened_at timestamptz, reopen_reason text
);
CREATE TABLE payroll_employee (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES payroll_run(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES branch(id),
  employee_id uuid NOT NULL REFERENCES employee(id),
  period_start date NOT NULL, period_end date NOT NULL,
  paid_days numeric(6,2) NOT NULL, unpaid_days numeric(6,2) NOT NULL DEFAULT 0, leave_days numeric(6,2) NOT NULL DEFAULT 0,
  ot_hours numeric(6,2) NOT NULL DEFAULT 0,
  earnings jsonb NOT NULL DEFAULT '{}',     -- component -> amount (incl. overtime, incentive)
  deductions jsonb NOT NULL DEFAULT '{}',   -- component or loan:<doc> or disciplinary -> amount
  gross numeric(14,2) NOT NULL, total_deductions numeric(14,2) NOT NULL, net numeric(14,2) NOT NULL CHECK (net >= 0),
  wps_fixed numeric(14,2) NOT NULL DEFAULT 0, wps_variable numeric(14,2) NOT NULL DEFAULT 0,
  carried_forward numeric(14,2) NOT NULL DEFAULT 0,
  accrual_gratuity numeric(14,2) NOT NULL DEFAULT 0, accrual_leave numeric(14,2) NOT NULL DEFAULT 0, accrual_ticket numeric(14,2) NOT NULL DEFAULT 0,
  gratuity_liability numeric(14,2) NOT NULL DEFAULT 0,
  loan_balance numeric(14,2) NOT NULL DEFAULT 0,
  flags jsonb NOT NULL DEFAULT '[]',
  UNIQUE (run_id, employee_id)
);
-- Cost per branch when an employee moved mid-month (PR-04).
CREATE TABLE payroll_branch_split (
  id bigserial PRIMARY KEY,
  run_id uuid NOT NULL REFERENCES payroll_run(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES branch(id),
  employee_id uuid NOT NULL REFERENCES employee(id),
  days int NOT NULL,
  share numeric(9,6) NOT NULL
);
CREATE TABLE loan_recovery (
  id bigserial PRIMARY KEY,
  branch_id uuid NOT NULL REFERENCES branch(id),
  loan_id uuid NOT NULL REFERENCES loan(id),
  run_id uuid REFERENCES payroll_run(id) ON DELETE CASCADE,
  settlement_id uuid,
  amount numeric(14,2) NOT NULL CHECK (amount > 0)
);
CREATE TABLE wps_file (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES payroll_run(id),
  agent_id uuid NOT NULL REFERENCES wps_agent(id),
  file_name text NOT NULL,
  content text NOT NULL,
  records int NOT NULL, total numeric(14,2) NOT NULL,
  created_by uuid, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE final_settlement (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES branch(id),
  doc_no text UNIQUE,
  employee_id uuid NOT NULL REFERENCES employee(id),
  last_day date NOT NULL,
  reason text NOT NULL CHECK (reason IN ('resignation','termination','end_of_contract','retirement','death','other')),
  contract_type text NOT NULL,
  service_years numeric(8,4) NOT NULL,
  basic numeric(14,2) NOT NULL,
  gratuity numeric(14,2) NOT NULL,
  unused_leave_days numeric(6,2) NOT NULL DEFAULT 0, leave_salary numeric(14,2) NOT NULL DEFAULT 0,
  unpaid_days numeric(6,2) NOT NULL DEFAULT 0, unpaid_salary numeric(14,2) NOT NULL DEFAULT 0,
  air_ticket numeric(14,2) NOT NULL DEFAULT 0,
  notice_days int NOT NULL DEFAULT 0, notice_pay numeric(14,2) NOT NULL DEFAULT 0,
  loans numeric(14,2) NOT NULL DEFAULT 0, other_deductions numeric(14,2) NOT NULL DEFAULT 0, deduction_note text,
  net numeric(14,2) NOT NULL,
  status text NOT NULL DEFAULT 'pending_approval' CHECK (status IN ('pending_approval','approved','rejected','paid')),
  journal_id uuid REFERENCES journal(id),
  reject_reason text,
  created_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), decided_at timestamptz
);
ALTER TABLE loan_recovery ADD CONSTRAINT lr_settlement FOREIGN KEY (settlement_id) REFERENCES final_settlement(id);

-- ---------- recruitment (HR-21) ----------
CREATE TABLE job_opening (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES branch(id),
  title text NOT NULL,
  department_id uuid REFERENCES department(id),
  designation_id uuid REFERENCES designation(id),
  positions int NOT NULL DEFAULT 1 CHECK (positions > 0),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  created_by uuid, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE applicant (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES branch(id),
  opening_id uuid NOT NULL REFERENCES job_opening(id),
  full_name text NOT NULL, mobile text, email text, nationality text REFERENCES country(code),
  stage text NOT NULL DEFAULT 'applied' CHECK (stage IN ('applied','interview','offer','hired','rejected')),
  interview_notes text, offer_salary numeric(14,2), offer_date date,
  employee_id uuid REFERENCES employee(id),
  created_by uuid, created_at timestamptz NOT NULL DEFAULT now()
);

-- ---------- row security ----------
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['employee','employee_record','employee_checklist','staff_transfer','punch','roster_day','leave_request','leave_adjustment',
    'overtime_request','hr_letter','salary_structure','salary_revision','loan','payroll_employee','payroll_branch_split','loan_recovery','final_settlement','job_opening','applicant'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY branch_scope ON %I USING (app_branch_ok(branch_id)) WITH CHECK (app_branch_ok(branch_id))', t);
  END LOOP;
END $$;
-- A transfer is also visible to the branch the employee left.
DROP POLICY branch_scope ON staff_transfer;
CREATE POLICY branch_scope ON staff_transfer USING (app_branch_ok(branch_id) OR app_branch_ok(from_branch_id)) WITH CHECK (app_branch_ok(branch_id) OR app_branch_ok(from_branch_id));

-- The line manager's user, for approvals that follow the reporting line (HR-14), even when the
-- manager works at a branch the requester cannot see.
CREATE OR REPLACE FUNCTION employee_line_manager_user(p_user uuid) RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT lm.user_id FROM employee e JOIN employee lm ON lm.id = e.line_manager_id
   WHERE e.user_id = p_user AND e.status = 'active' AND lm.status = 'active' LIMIT 1
$$;
CREATE OR REPLACE FUNCTION employee_line_manager_of(p_employee uuid) RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT lm.user_id FROM employee e JOIN employee lm ON lm.id = e.line_manager_id
   WHERE e.id = p_employee AND lm.status = 'active' LIMIT 1
$$;
ALTER TABLE workflow_step DROP CONSTRAINT workflow_step_approver_role_scope_check;
ALTER TABLE workflow_step ADD CONSTRAINT workflow_step_approver_role_scope_check CHECK (approver_role_scope IN ('doc_branch','supplying_branch','any_branch','line_manager'));
-- Which employee a request is about (for line-manager steps where HR raises the request).
ALTER TABLE approval_request ADD COLUMN subject_employee_id uuid;

-- Employee numbers SF-1001, SF-1002 ... unless HR keeps the Tally number.
CREATE SEQUENCE employee_no_seq START 1001;

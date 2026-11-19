-- 022 Customer complaint list (demo check-in: pick the complaint from a list, each suggests a service)
-- and customer feedback after delivery (a rating link sent on WhatsApp; low ratings are followed up).
CREATE TABLE customer_complaint (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_name text NOT NULL,
  name_en text NOT NULL,
  name_ar text,
  service_id uuid REFERENCES service(id),
  sort int NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  UNIQUE (group_name, name_en)
);

CREATE TABLE job_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES branch(id),
  job_card_id uuid NOT NULL UNIQUE REFERENCES job_card(id),
  token text NOT NULL UNIQUE CHECK (length(token) >= 32),
  asked_at timestamptz NOT NULL DEFAULT now(),
  asked_by uuid,
  rating int CHECK (rating BETWEEN 1 AND 5),
  comment text CHECK (comment IS NULL OR length(comment) <= 1000),
  answered_at timestamptz,
  followed_up_at timestamptz,
  followed_up_by uuid,
  follow_up_note text
);
ALTER TABLE job_feedback ENABLE ROW LEVEL SECURITY;
CREATE POLICY branch_scope ON job_feedback USING (app_branch_ok(branch_id)) WITH CHECK (app_branch_ok(branch_id));

-- The public feedback page resolves its token to the branch while it is waiting for an answer.
CREATE OR REPLACE FUNCTION feedback_branch_by_token(p_token text)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT branch_id FROM job_feedback WHERE token = p_token AND length(p_token) >= 32 AND asked_at > now() - interval '30 days'
$$;

INSERT INTO message_template (event, language, body)
SELECT 'feedback', 'en', 'Dear {title} {name}, thank you for choosing Superfix {branch} for {plate}. How did we do? Tap to rate us, it takes ten seconds: {link}'
WHERE NOT EXISTS (SELECT 1 FROM message_template WHERE event = 'feedback' AND language = 'en');
INSERT INTO message_template (event, language, body)
SELECT 'feedback', 'ar', 'عزيزي {title} {name}، شكراً لاختيارك سوبرفكس {branch} لسيارتك {plate}. كيف كانت خدمتنا؟ قيّمنا من هنا: {link}'
WHERE NOT EXISTS (SELECT 1 FROM message_template WHERE event = 'feedback' AND language = 'ar');

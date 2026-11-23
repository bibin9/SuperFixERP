-- 032 CV-03: approved drivers of a corporate or government account. Shared with the customer across
-- branches, like the customer itself. Deactivated, never deleted, so delivery records keep their name.
CREATE TABLE customer_driver (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES customer(id),
  name text NOT NULL CHECK (btrim(name) <> ''),
  mobile text,
  licence_no text,
  active boolean NOT NULL DEFAULT true,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX customer_driver_customer ON customer_driver (customer_id) WHERE active;

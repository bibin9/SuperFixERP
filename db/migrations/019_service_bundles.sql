-- 019 Service bundles (demo QT-05): one tap adds a whole service to the quotation, every labour
-- line and part with its quantity. Prices come from the service and part masters when added, so a
-- bundle never holds its own prices. "For vehicles" is a hint shown to the advisor (for example
-- "Toyota Land Cruiser"); a bundle that matches the car's make or model is shown first.
CREATE TABLE service_bundle (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name_en text NOT NULL,
  name_ar text,
  for_vehicles text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  version int NOT NULL DEFAULT 1
);
CREATE TABLE service_bundle_line (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bundle_id uuid NOT NULL REFERENCES service_bundle(id) ON DELETE CASCADE,
  line_no int NOT NULL,
  service_id uuid REFERENCES service(id),
  item_id uuid REFERENCES item(id),
  qty numeric(12,3) NOT NULL DEFAULT 1 CHECK (qty > 0),
  CHECK ((service_id IS NULL) <> (item_id IS NULL)),
  UNIQUE (bundle_id, line_no)
);
CREATE INDEX service_bundle_line_bundle_idx ON service_bundle_line (bundle_id);

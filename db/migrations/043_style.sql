-- 043 UX: night mode and the company's own style. Company-wide (branch_id NULL); each user picks
-- light, dark or automatic on their own device, starting from the default here.
INSERT INTO setting (key, value, grp, description)
SELECT k, v::jsonb, 'Style', d FROM (VALUES
  ('style.brand_color', '"#EC3542"', 'Main colour: buttons, highlights and badges'),
  ('style.menu_color', '"#0d1b2e"', 'Colour of the side menu'),
  ('style.link_color', '"#1f4fbf"', 'Colour of links'),
  ('style.default_mode', '"light"', 'Starting look for every user: light, dark or auto (follows the device)'),
  ('style.text_size', '"normal"', 'Text size: small, normal or large'),
  ('style.density', '"comfortable"', 'Spacing: comfortable or compact'),
  ('style.app_name', '"AUTOVIQO"', 'Name shown at the top of the menu'),
  ('style.app_tagline', '"for Superfix Auto Centers"', 'Line under the name'),
  ('style.logo', '""', 'Company logo shown in the menu (picture, set on the Style page)')
) x(k, v, d)
WHERE NOT EXISTS (SELECT 1 FROM setting s WHERE s.key = x.k AND s.branch_id IS NULL);

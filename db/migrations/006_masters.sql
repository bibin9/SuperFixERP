-- FSD v0.10 change 3: every business value is a setting or a master record with its own form.
-- Masters that had no "active" flag get one so they can be deactivated instead of deleted.
ALTER TABLE tax_code ADD COLUMN active boolean NOT NULL DEFAULT true;
ALTER TABLE country ADD COLUMN active boolean NOT NULL DEFAULT true;

-- Payment methods were a fixed list in code. Each method now names the posting event (account
-- mapping) its receipts debit, and whether a reference (card slip, cheque no.) is required.
CREATE TABLE payment_method (
  code text PRIMARY KEY CHECK (code ~ '^[a-z0-9_]{2,30}$'),
  name text NOT NULL,
  posting_event text NOT NULL,
  needs_reference boolean NOT NULL DEFAULT false,
  sort int NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true
);
INSERT INTO payment_method (code, name, posting_event, needs_reference, sort) VALUES
  ('cash','Cash','cash_drawer',false,1), ('card','Card','card_clearing',true,2),
  ('bank_transfer','Bank transfer','bank',true,3), ('cheque','Cheque','pdc_received',true,4)
ON CONFLICT DO NOTHING;
ALTER TABLE receipt DROP CONSTRAINT IF EXISTS receipt_method_check;
ALTER TABLE receipt ADD CONSTRAINT receipt_method_fk FOREIGN KEY (method) REFERENCES payment_method(code);

-- Bay types, item categories, units and service categories come from admin lists (lookup_value).
ALTER TABLE bay DROP CONSTRAINT IF EXISTS bay_bay_type_check;
INSERT INTO lookup_value (list, code, name_en, sort) VALUES
  ('bay_type','lift','Lift',1), ('bay_type','alignment','Alignment',2), ('bay_type','tyre','Tyre',3), ('bay_type','wash','Wash',4), ('bay_type','general','General',5),
  ('item_category','parts','Parts',1), ('item_category','oils','Oils and fluids',2), ('item_category','filters','Filters',3), ('item_category','brakes','Brakes',4),
  ('item_category','tyres','Tyres',5), ('item_category','batteries','Batteries',6), ('item_category','accessories','Accessories',7), ('item_category','consumables','Consumables',8),
  ('uom','EA','Each',1), ('uom','L','Litre',2), ('uom','SET','Set',3), ('uom','KG','Kilogram',4),
  ('service_category','service','Service',1), ('service_category','repair','Repair',2), ('service_category','tyre','Tyres',3), ('service_category','quick','Quick service',4), ('service_category','ac','Air conditioning',5), ('service_category','diagnostics','Diagnostics',6)
ON CONFLICT DO NOTHING;

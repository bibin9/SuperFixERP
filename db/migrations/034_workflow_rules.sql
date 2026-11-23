-- 034 WF-03: approval steps can also depend on the supplier, the customer and the item category on the
-- document. NULL means no condition; all conditions on a step are combined with AND. The request keeps
-- what it was matched on, so later steps are matched on the same facts.
ALTER TABLE workflow_step ADD COLUMN cond_supplier_id uuid REFERENCES supplier(id);
ALTER TABLE workflow_step ADD COLUMN cond_customer_id uuid REFERENCES customer(id);
ALTER TABLE workflow_step ADD COLUMN cond_item_category text;
ALTER TABLE approval_request ADD COLUMN supplier_id uuid;
ALTER TABLE approval_request ADD COLUMN customer_id uuid;
ALTER TABLE approval_request ADD COLUMN item_categories text[];

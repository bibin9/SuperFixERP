-- Default rows per page for every list grid; each user can change it per grid on the grid itself.
INSERT INTO setting (key, value, grp, description)
SELECT 'lists.page_size', '25', 'Lists', 'Rows per page on list grids before paging (10, 25, 50, 100 or 200). Users can change it on each grid.'
WHERE NOT EXISTS (SELECT 1 FROM setting WHERE key = 'lists.page_size' AND branch_id IS NULL);

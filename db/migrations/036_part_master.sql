-- 036 IN-01: part master cross-references. A barcode (unique), the OEM part number, aftermarket and
-- alternative part numbers, and the vehicles a part fits. All of them are searchable, and the barcode
-- is what a scanner reads (IN-07, UX-03).
ALTER TABLE item ADD COLUMN barcode text, ADD COLUMN oem_part_no text, ADD COLUMN alt_part_nos text, ADD COLUMN fits_vehicles text;
CREATE UNIQUE INDEX item_barcode_key ON item (upper(btrim(barcode))) WHERE barcode IS NOT NULL AND btrim(barcode) <> '';
-- Every code a part can be found by, upper case and separated by |, for search and scanning.
ALTER TABLE item ADD COLUMN search_codes text GENERATED ALWAYS AS (
  upper(btrim(part_no) || '|' || coalesce(btrim(barcode), '') || '|' || coalesce(btrim(oem_part_no), '') || '|' || regexp_replace(btrim(coalesce(alt_part_nos, '')), '\s*[,;]\s*', '|', 'g'))) STORED;

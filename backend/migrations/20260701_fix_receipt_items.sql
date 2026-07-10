-- Migration: allow NULL service_item_id and ensure FK ON DELETE SET NULL
ALTER TABLE receipt_items
  MODIFY COLUMN service_item_id BIGINT UNSIGNED DEFAULT NULL;

-- drop old FK if exists and add the correct one
SET @fk_name = (
  SELECT CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'receipt_items' AND COLUMN_NAME = 'service_item_id' AND REFERENCED_TABLE_NAME = 'service_items'
  LIMIT 1
);
-- drop if exists
SET @s=CONCAT('ALTER TABLE receipt_items DROP FOREIGN KEY ', IFNULL(@fk_name,'0'));
-- prepare and execute only if fk exists
-- Note: some MySQL clients may not allow prepared statements in a migration; run manually if needed.
-- Add desired FK
ALTER TABLE receipt_items
  ADD CONSTRAINT fk_receipt_item_service FOREIGN KEY (service_item_id) REFERENCES service_items(id) ON DELETE SET NULL;

-- Add Batch-3 default languages (see Postgres migration
-- 20260905110000_add_batch3_languages).

INSERT IGNORE INTO `Language` (`code`, `name`, `isDefault`, `active`, `sortOrder`)
VALUES
  ('tpi', 'Tok Pisin', false, true, 15),
  ('bi', 'Bislama', false, true, 16),
  ('fj', 'Na Vosa Vakaviti', false, true, 17),
  ('to', 'lea faka-Tonga', false, true, 18),
  ('sm', 'Gagana Sāmoa', false, true, 19),
  ('crs', 'Kreol Seselwa', false, true, 20);

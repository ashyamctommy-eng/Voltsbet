-- Add Batch-3 default languages for the currency-batch countries (Tonga,
-- Samoa, Fiji, Papua New Guinea, Vanuatu, Seychelles). Translation packs are
-- not shipped yet — the UI falls back to English until they are added.

INSERT INTO "Language" ("code", "name", "isDefault", "active", "sortOrder")
VALUES
  ('tpi', 'Tok Pisin', false, true, 15),
  ('bi', 'Bislama', false, true, 16),
  ('fj', 'Na Vosa Vakaviti', false, true, 17),
  ('to', 'lea faka-Tonga', false, true, 18),
  ('sm', 'Gagana Sāmoa', false, true, 19),
  ('crs', 'Kreol Seselwa', false, true, 20)
ON CONFLICT ("code") DO NOTHING;

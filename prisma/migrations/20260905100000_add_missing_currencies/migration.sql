-- Add missing display/conversion currencies (Papua New Guinea, Bolivia,
-- Cape Verde, São Tomé & Príncipe, Paraguay, Vanuatu, Tonga, Fiji, Samoa,
-- French Polynesia/New Caledonia (XPF), Belize, Grenada/Antigua (XCD),
-- Honduras, Trinidad & Tobago, Seychelles, Suriname, Guyana).
-- Rates = KES per 1 unit, seeded from open.er-api on 2026-09-05 — the
-- rate cron / admin "Sync market rates" keeps them fresh afterwards.

-- AlterTable (data only — no schema change)

INSERT INTO "Currency" ("code", "name", "symbol", "decimals", "rate", "isDefault", "active", "sortOrder")
VALUES
  ('PGK', 'Papua New Guinean Kina', 'K', 2, 29.013259, false, true, 20),
  ('BOB', 'Bolivian Boliviano', 'Bs.', 2, 10.652690, false, true, 21),
  ('CVE', 'Cape Verdean Escudo', '$', 2, 1.370791, false, true, 22),
  ('STN', 'São Tomé & Príncipe Dobra', 'Db', 2, 6.169412, false, true, 23),
  ('PYG', 'Paraguayan Guaraní', '₲', 0, 0.021914, false, true, 24),
  ('VUV', 'Vanuatu Vatu', 'VT', 0, 1.090131, false, true, 25),
  ('TOP', 'Tongan Paʻanga', 'T$', 2, 54.212295, false, true, 26),
  ('FJD', 'Fijian Dollar', 'FJ$', 2, 59.203126, false, true, 27),
  ('WST', 'Samoan Tālā', 'WS$', 2, 47.814861, false, true, 28),
  ('XPF', 'CFP Franc', '₣', 0, 1.266636, false, true, 29),
  ('BZD', 'Belize Dollar', 'BZ$', 2, 64.695607, false, true, 30),
  ('XCD', 'East Caribbean Dollar', 'EC$', 2, 47.922557, false, true, 31),
  ('HNL', 'Honduran Lempira', 'L', 2, 4.824485, false, true, 32),
  ('TTD', 'Trinidad & Tobago Dollar', 'TT$', 2, 19.117535, false, true, 33),
  ('SCR', 'Seychellois Rupee', '₨', 2, 9.071200, false, true, 34),
  ('SRD', 'Surinamese Dollar', 'Sr$', 2, 3.409664, false, true, 35),
  ('GYD', 'Guyanese Dollar', 'G$', 2, 0.618430, false, true, 36)
ON CONFLICT ("code") DO NOTHING;

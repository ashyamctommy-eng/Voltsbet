-- Derived-markets engine: flag auto-generated markets so the sync can
-- regenerate them every cycle without touching API or admin-created markets.
-- Legacy claim: the old engine only ever created DOUBLE_CHANCE / DRAW_NO_BET
-- derived markets — mark them so the engine keeps updating them seamlessly.
ALTER TABLE "Market" ADD COLUMN "isDerived" BOOLEAN NOT NULL DEFAULT false;
UPDATE "Market" SET "isDerived" = true
  WHERE "isManual" = false AND "key" IN ('DOUBLE_CHANCE', 'DRAW_NO_BET');

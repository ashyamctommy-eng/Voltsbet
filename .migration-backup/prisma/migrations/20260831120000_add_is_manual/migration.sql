-- Admin custom market injection: flag admin-created markets/outcomes so the
-- odds sync never overwrites or suspends them.
ALTER TABLE "Market" ADD COLUMN "isManual" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Outcome" ADD COLUMN "isManual" BOOLEAN NOT NULL DEFAULT false;

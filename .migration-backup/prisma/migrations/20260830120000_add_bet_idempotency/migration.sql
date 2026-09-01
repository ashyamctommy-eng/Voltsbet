-- AlterTable
ALTER TABLE "Bet" ADD COLUMN "idempotencyKey" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Bet_idempotencyKey_key" ON "Bet"("idempotencyKey");

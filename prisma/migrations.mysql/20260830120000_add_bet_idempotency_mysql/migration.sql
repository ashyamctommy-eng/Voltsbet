-- AlterTable
ALTER TABLE `Bet` ADD COLUMN `idempotencyKey` VARCHAR(191) NULL;

-- CreateIndex
CREATE UNIQUE INDEX `Bet_idempotencyKey_key` ON `Bet`(`idempotencyKey`);

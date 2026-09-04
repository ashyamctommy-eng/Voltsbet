-- Add registration-bonus deposit-lock support
-- (signup bonus credited to Wallet.bonusBalance; Bet.bonusStake tracks the
--  bonus-funded portion of a stake for source-aware refunds)

-- AlterTable
ALTER TABLE `User` ADD COLUMN `hasDeposited` BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE `Bet` ADD COLUMN `bonusStake` DECIMAL(65,30) NOT NULL DEFAULT 0;

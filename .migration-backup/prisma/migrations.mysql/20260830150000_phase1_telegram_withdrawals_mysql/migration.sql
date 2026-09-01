-- Phase 1: purge TOTP 2FA, add Telegram linking + OTP store, withdrawal tracking IDs

-- AlterTable: User — drop TOTP, add Telegram link fields
ALTER TABLE `User` DROP COLUMN `totpSecret`,
DROP COLUMN `totpEnabled`,
ADD COLUMN `telegramChatId` VARCHAR(191) NULL,
ADD COLUMN `telegramUsername` VARCHAR(191) NULL,
ADD COLUMN `telegramLinkedAt` DATETIME(3) NULL;

-- AlterTable: Withdrawal — human-friendly tracking reference
ALTER TABLE `Withdrawal` ADD COLUMN `trackingId` VARCHAR(191) NULL;

-- CreateTable: OTP store (codes are sha256-hashed; plaintext only in Telegram DM)
CREATE TABLE `OtpCode` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `purpose` VARCHAR(191) NOT NULL DEFAULT 'LOGIN',
    `channel` VARCHAR(191) NOT NULL DEFAULT 'TELEGRAM',
    `codeHash` VARCHAR(191) NOT NULL,
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `expiresAt` DATETIME(3) NOT NULL,
    `consumedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `OtpCode_userId_purpose_idx`(`userId`, `purpose`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable: single-use deep-link tokens for t.me/<bot>?start=<token>
CREATE TABLE `TelegramLinkToken` (
    `id` VARCHAR(191) NOT NULL,
    `token` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `usedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `TelegramLinkToken_token_key`(`token`),
    INDEX `TelegramLinkToken_userId_idx`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
ALTER TABLE `User` ADD UNIQUE INDEX `User_telegramChatId_key`(`telegramChatId`);

-- CreateIndex
ALTER TABLE `Withdrawal` ADD UNIQUE INDEX `Withdrawal_trackingId_key`(`trackingId`);

-- AddForeignKey
ALTER TABLE `OtpCode` ADD CONSTRAINT `OtpCode_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TelegramLinkToken` ADD CONSTRAINT `TelegramLinkToken_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

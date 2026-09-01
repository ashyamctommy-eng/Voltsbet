-- CreateTable
CREATE TABLE `User` (
    `id` VARCHAR(191) NOT NULL,
    `fullName` VARCHAR(191) NOT NULL,
    `username` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `phone` VARCHAR(191) NOT NULL,
    `passwordHash` VARCHAR(191) NOT NULL,
    `country` VARCHAR(191) NULL,
    `languageCode` VARCHAR(191) NOT NULL DEFAULT 'en',
    `currencyCode` VARCHAR(191) NOT NULL DEFAULT 'KES',
    `displayCurrencyCode` VARCHAR(191) NULL,
    `role` VARCHAR(191) NOT NULL DEFAULT 'CUSTOMER',
    `status` VARCHAR(191) NOT NULL DEFAULT 'ACTIVE',
    `verified` BOOLEAN NOT NULL DEFAULT false,
    `referralCode` VARCHAR(191) NULL,
    `referredByCode` VARCHAR(191) NULL,
    `failedLogins` INTEGER NOT NULL DEFAULT 0,
    `lockedUntil` DATETIME(3) NULL,
    `totpSecret` VARCHAR(191) NULL,
    `totpEnabled` BOOLEAN NOT NULL DEFAULT false,
    `lastLoginAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `User_username_key`(`username`),
    UNIQUE INDEX `User_email_key`(`email`),
    UNIQUE INDEX `User_phone_key`(`phone`),
    UNIQUE INDEX `User_referralCode_key`(`referralCode`),
    INDEX `User_role_idx`(`role`),
    INDEX `User_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Session` (
    `id` VARCHAR(191) NOT NULL,
    `token` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `ip` VARCHAR(191) NULL,
    `userAgent` VARCHAR(191) NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `Session_token_key`(`token`),
    INDEX `Session_userId_idx`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Sport` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `slug` VARCHAR(191) NOT NULL,
    `icon` VARCHAR(191) NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `isPopular` BOOLEAN NOT NULL DEFAULT false,

    UNIQUE INDEX `Sport_slug_key`(`slug`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Competition` (
    `id` VARCHAR(191) NOT NULL,
    `sportId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `country` VARCHAR(191) NULL,
    `logo` VARCHAR(191) NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `active` BOOLEAN NOT NULL DEFAULT true,

    INDEX `Competition_sportId_idx`(`sportId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Team` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `sportId` VARCHAR(191) NULL,
    `country` VARCHAR(191) NULL,
    `logo` VARCHAR(191) NULL,

    INDEX `Team_name_idx`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Game` (
    `id` VARCHAR(191) NOT NULL,
    `sportId` VARCHAR(191) NOT NULL,
    `competitionId` VARCHAR(191) NULL,
    `competitionName` VARCHAR(191) NULL,
    `homeName` VARCHAR(191) NOT NULL,
    `awayName` VARCHAR(191) NOT NULL,
    `homeLogo` VARCHAR(191) NULL,
    `awayLogo` VARCHAR(191) NULL,
    `startAt` DATETIME(3) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'SCHEDULED',
    `homeScore` INTEGER NOT NULL DEFAULT 0,
    `awayScore` INTEGER NOT NULL DEFAULT 0,
    `halfHomeScore` INTEGER NULL,
    `halfAwayScore` INTEGER NULL,
    `period` VARCHAR(191) NULL,
    `clock` VARCHAR(191) NULL,
    `source` VARCHAR(191) NOT NULL DEFAULT 'MANUAL',
    `externalId` VARCHAR(191) NULL,
    `featured` BOOLEAN NOT NULL DEFAULT false,
    `live` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Game_externalId_key`(`externalId`),
    INDEX `Game_sportId_startAt_idx`(`sportId`, `startAt`),
    INDEX `Game_status_idx`(`status`),
    INDEX `Game_startAt_idx`(`startAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Market` (
    `id` VARCHAR(191) NOT NULL,
    `gameId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `key` VARCHAR(191) NOT NULL DEFAULT 'CUSTOM',
    `description` VARCHAR(191) NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'OPEN',
    `settlementMethod` VARCHAR(191) NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,

    INDEX `Market_gameId_idx`(`gameId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Outcome` (
    `id` VARCHAR(191) NOT NULL,
    `marketId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `label` VARCHAR(191) NULL,
    `odds` DECIMAL(65, 30) NOT NULL DEFAULT 1,
    `status` VARCHAR(191) NOT NULL DEFAULT 'ACTIVE',
    `settled` BOOLEAN NOT NULL DEFAULT false,
    `result` VARCHAR(191) NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,

    INDEX `Outcome_marketId_idx`(`marketId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Bet` (
    `id` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `type` VARCHAR(191) NOT NULL DEFAULT 'SINGLE',
    `stake` DECIMAL(65, 30) NOT NULL,
    `totalOdds` DECIMAL(65, 30) NOT NULL,
    `potentialWin` DECIMAL(65, 30) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'OPEN',
    `settledAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `Bet_code_key`(`code`),
    INDEX `Bet_userId_createdAt_idx`(`userId`, `createdAt`),
    INDEX `Bet_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `BetSelection` (
    `id` VARCHAR(191) NOT NULL,
    `betId` VARCHAR(191) NOT NULL,
    `gameId` VARCHAR(191) NOT NULL,
    `marketId` VARCHAR(191) NOT NULL,
    `outcomeId` VARCHAR(191) NOT NULL,
    `marketName` VARCHAR(191) NOT NULL,
    `outcomeName` VARCHAR(191) NOT NULL,
    `label` VARCHAR(191) NULL,
    `oddsAtPlacement` DECIMAL(65, 30) NOT NULL,
    `result` VARCHAR(191) NULL,
    `settled` BOOLEAN NOT NULL DEFAULT false,

    INDEX `BetSelection_betId_idx`(`betId`),
    INDEX `BetSelection_outcomeId_idx`(`outcomeId`),
    INDEX `BetSelection_gameId_idx`(`gameId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Wallet` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `balance` DECIMAL(65, 30) NOT NULL DEFAULT 0,
    `bonusBalance` DECIMAL(65, 30) NOT NULL DEFAULT 0,
    `currencyCode` VARCHAR(191) NOT NULL DEFAULT 'KES',
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Wallet_userId_key`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Transaction` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `type` VARCHAR(191) NOT NULL,
    `amount` DECIMAL(65, 30) NOT NULL,
    `currencyCode` VARCHAR(191) NOT NULL,
    `prevBalance` DECIMAL(65, 30) NOT NULL,
    `newBalance` DECIMAL(65, 30) NOT NULL,
    `reason` VARCHAR(191) NULL,
    `reference` VARCHAR(191) NULL,
    `createdById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `Transaction_userId_createdAt_idx`(`userId`, `createdAt`),
    INDEX `Transaction_type_idx`(`type`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Deposit` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `provider` VARCHAR(191) NOT NULL DEFAULT 'MANUAL',
    `method` VARCHAR(191) NOT NULL DEFAULT 'CRYPTO',
    `amount` DECIMAL(65, 30) NOT NULL,
    `currencyCode` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'PAYMENT_CREATED',
    `cryptoCurrency` VARCHAR(191) NULL,
    `network` VARCHAR(191) NULL,
    `paymentAddress` VARCHAR(191) NULL,
    `txHash` VARCHAR(191) NULL,
    `fiatValue` DECIMAL(65, 30) NULL,
    `exchangeRate` DECIMAL(65, 30) NULL,
    `expiresAt` DATETIME(3) NULL,
    `confirmedAt` DATETIME(3) NULL,
    `metadata` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `Deposit_userId_createdAt_idx`(`userId`, `createdAt`),
    INDEX `Deposit_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Withdrawal` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `amount` DECIMAL(65, 30) NOT NULL,
    `currencyCode` VARCHAR(191) NOT NULL,
    `method` VARCHAR(191) NOT NULL DEFAULT 'CRYPTO',
    `destination` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'PENDING',
    `adminNote` VARCHAR(191) NULL,
    `metadata` VARCHAR(191) NULL,
    `processedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `Withdrawal_userId_createdAt_idx`(`userId`, `createdAt`),
    INDEX `Withdrawal_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Currency` (
    `code` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `symbol` VARCHAR(191) NOT NULL,
    `decimals` INTEGER NOT NULL DEFAULT 2,
    `rate` DECIMAL(65, 30) NOT NULL DEFAULT 1,
    `isDefault` BOOLEAN NOT NULL DEFAULT false,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,

    PRIMARY KEY (`code`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Language` (
    `code` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `isDefault` BOOLEAN NOT NULL DEFAULT false,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,

    PRIMARY KEY (`code`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Translation` (
    `id` VARCHAR(191) NOT NULL,
    `langCode` VARCHAR(191) NOT NULL,
    `key` VARCHAR(191) NOT NULL,
    `value` VARCHAR(191) NOT NULL,

    UNIQUE INDEX `Translation_langCode_key_key`(`langCode`, `key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Banner` (
    `id` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NULL,
    `description` VARCHAR(191) NULL,
    `image` VARCHAR(191) NOT NULL,
    `ctaText` VARCHAR(191) NULL,
    `ctaUrl` VARCHAR(191) NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Promotion` (
    `id` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `description` VARCHAR(191) NULL,
    `image` VARCHAR(191) NULL,
    `bonusType` VARCHAR(191) NULL,
    `bonusValue` DECIMAL(65, 30) NULL,
    `startAt` DATETIME(3) NULL,
    `endAt` DATETIME(3) NULL,
    `terms` VARCHAR(191) NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Testimonial` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `avatar` VARCHAR(191) NULL,
    `rating` INTEGER NOT NULL DEFAULT 5,
    `text` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'APPROVED',
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Notification` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NULL,
    `title` VARCHAR(191) NOT NULL,
    `message` VARCHAR(191) NOT NULL,
    `type` VARCHAR(191) NOT NULL DEFAULT 'GENERAL',
    `read` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `Notification_userId_idx`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `StatusType` (
    `id` VARCHAR(191) NOT NULL,
    `type` VARCHAR(191) NOT NULL,
    `key` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `description` VARCHAR(191) NULL,
    `color` VARCHAR(191) NULL,
    `icon` VARCHAR(191) NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `allowedActions` VARCHAR(191) NULL,
    `blockedActions` VARCHAR(191) NULL,

    UNIQUE INDEX `StatusType_type_key_key`(`type`, `key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Setting` (
    `key` VARCHAR(191) NOT NULL,
    `value` VARCHAR(191) NOT NULL,

    PRIMARY KEY (`key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AuditLog` (
    `id` VARCHAR(191) NOT NULL,
    `adminId` VARCHAR(191) NULL,
    `adminName` VARCHAR(191) NULL,
    `action` VARCHAR(191) NOT NULL,
    `entity` VARCHAR(191) NOT NULL,
    `entityId` VARCHAR(191) NULL,
    `userId` VARCHAR(191) NULL,
    `gameId` VARCHAR(191) NULL,
    `ip` VARCHAR(191) NULL,
    `prevValue` VARCHAR(191) NULL,
    `newValue` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `AuditLog_entity_entityId_idx`(`entity`, `entityId`),
    INDEX `AuditLog_adminId_idx`(`adminId`),
    INDEX `AuditLog_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Session` ADD CONSTRAINT `Session_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Competition` ADD CONSTRAINT `Competition_sportId_fkey` FOREIGN KEY (`sportId`) REFERENCES `Sport`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Game` ADD CONSTRAINT `Game_sportId_fkey` FOREIGN KEY (`sportId`) REFERENCES `Sport`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Game` ADD CONSTRAINT `Game_competitionId_fkey` FOREIGN KEY (`competitionId`) REFERENCES `Competition`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Market` ADD CONSTRAINT `Market_gameId_fkey` FOREIGN KEY (`gameId`) REFERENCES `Game`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Outcome` ADD CONSTRAINT `Outcome_marketId_fkey` FOREIGN KEY (`marketId`) REFERENCES `Market`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Bet` ADD CONSTRAINT `Bet_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `BetSelection` ADD CONSTRAINT `BetSelection_betId_fkey` FOREIGN KEY (`betId`) REFERENCES `Bet`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `BetSelection` ADD CONSTRAINT `BetSelection_gameId_fkey` FOREIGN KEY (`gameId`) REFERENCES `Game`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `BetSelection` ADD CONSTRAINT `BetSelection_marketId_fkey` FOREIGN KEY (`marketId`) REFERENCES `Market`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `BetSelection` ADD CONSTRAINT `BetSelection_outcomeId_fkey` FOREIGN KEY (`outcomeId`) REFERENCES `Outcome`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Wallet` ADD CONSTRAINT `Wallet_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Transaction` ADD CONSTRAINT `Transaction_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Deposit` ADD CONSTRAINT `Deposit_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Withdrawal` ADD CONSTRAINT `Withdrawal_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Notification` ADD CONSTRAINT `Notification_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;


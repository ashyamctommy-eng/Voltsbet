-- CreateTable
CREATE TABLE `WebhookEvent` (
    `id` VARCHAR(191) NOT NULL,
    `eventId` VARCHAR(191) NOT NULL,
    `source` VARCHAR(191) NOT NULL DEFAULT 'settle-worker',
    `gameId` VARCHAR(191) NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'RECEIVED',
    `payload` TEXT NULL,
    `payloadHash` VARCHAR(191) NULL,
    `settled` INTEGER NOT NULL DEFAULT 0,
    `voided` INTEGER NOT NULL DEFAULT 0,
    `skipped` INTEGER NOT NULL DEFAULT 0,
    `error` VARCHAR(191) NULL,
    `receivedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `processedAt` DATETIME(3) NULL,

    UNIQUE INDEX `WebhookEvent_eventId_key`(`eventId`),
    INDEX `WebhookEvent_gameId_idx`(`gameId`),
    INDEX `WebhookEvent_status_idx`(`status`),
    INDEX `WebhookEvent_receivedAt_idx`(`receivedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `GameStats` (
    `id` VARCHAR(191) NOT NULL,
    `gameId` VARCHAR(191) NOT NULL,
    `htHomeCorners` INTEGER NULL,
    `htAwayCorners` INTEGER NULL,
    `ftHomeCorners` INTEGER NULL,
    `ftAwayCorners` INTEGER NULL,
    `htHomeYellows` INTEGER NULL,
    `htAwayYellows` INTEGER NULL,
    `ftHomeYellows` INTEGER NULL,
    `ftAwayYellows` INTEGER NULL,
    `htHomeReds` INTEGER NULL,
    `htAwayReds` INTEGER NULL,
    `ftHomeReds` INTEGER NULL,
    `ftAwayReds` INTEGER NULL,
    `source` VARCHAR(191) NOT NULL DEFAULT 'settle-worker',
    `capturedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `GameStats_gameId_key`(`gameId`),
    INDEX `GameStats_updatedAt_idx`(`updatedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `GameStats` ADD CONSTRAINT `GameStats_gameId_fkey` FOREIGN KEY (`gameId`) REFERENCES `Game`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;


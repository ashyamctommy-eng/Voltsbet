-- CreateTable
CREATE TABLE `Broadcast` (
    `id` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `message` TEXT NOT NULL,
    `targetType` VARCHAR(191) NOT NULL DEFAULT 'ALL',
    `userId` VARCHAR(191) NULL,
    `createdBy` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `Broadcast_targetType_userId_idx` ON `Broadcast`(`targetType`, `userId`);

-- CreateIndex
CREATE INDEX `Broadcast_createdAt_idx` ON `Broadcast`(`createdAt`);

-- AddForeignKey
ALTER TABLE `Broadcast` ADD CONSTRAINT `Broadcast_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

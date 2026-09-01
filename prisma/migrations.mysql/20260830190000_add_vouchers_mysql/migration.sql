-- CreateTable
CREATE TABLE `VoucherBatch` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NULL,
    `currency` VARCHAR(191) NOT NULL,
    `value` DECIMAL(65,30) NOT NULL,
    `quantity` INTEGER NOT NULL,
    `prefix` VARCHAR(191) NULL,
    `notes` TEXT NULL,
    `createdBy` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Voucher` (
    `id` VARCHAR(191) NOT NULL,
    `codeHash` VARCHAR(191) NOT NULL,
    `codeLast4` VARCHAR(191) NOT NULL,
    `displayCode` VARCHAR(191) NOT NULL,
    `value` DECIMAL(65,30) NOT NULL,
    `currency` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'UNUSED',
    `batchId` VARCHAR(191) NULL,
    `expiresAt` DATETIME(3) NULL,
    `notes` TEXT NULL,
    `createdById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `redeemedAt` DATETIME(3) NULL,
    `redeemedById` VARCHAR(191) NULL,
    `cancelledAt` DATETIME(3) NULL,
    `cancelledBy` VARCHAR(191) NULL,
    `suspendedAt` DATETIME(3) NULL,
    `suspendedBy` VARCHAR(191) NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `VoucherRedemption` (
    `id` VARCHAR(191) NOT NULL,
    `voucherId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `transactionId` VARCHAR(191) NULL,
    `amount` DECIMAL(65,30) NOT NULL,
    `currency` VARCHAR(191) NOT NULL,
    `redeemedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `ipAddress` VARCHAR(191) NULL,
    `deviceInfo` VARCHAR(191) NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE UNIQUE INDEX `Voucher_codeHash_key` ON `Voucher`(`codeHash`);

-- CreateIndex
CREATE INDEX `Voucher_status_idx` ON `Voucher`(`status`);

-- CreateIndex
CREATE INDEX `Voucher_currency_idx` ON `Voucher`(`currency`);

-- CreateIndex
CREATE INDEX `Voucher_batchId_idx` ON `Voucher`(`batchId`);

-- CreateIndex
CREATE INDEX `Voucher_createdAt_idx` ON `Voucher`(`createdAt`);

-- CreateIndex
CREATE UNIQUE INDEX `VoucherRedemption_voucherId_key` ON `VoucherRedemption`(`voucherId`);

-- CreateIndex
CREATE INDEX `VoucherRedemption_userId_redeemedAt_idx` ON `VoucherRedemption`(`userId`, `redeemedAt`);

-- AddForeignKey
ALTER TABLE `Voucher` ADD CONSTRAINT `Voucher_batchId_fkey` FOREIGN KEY (`batchId`) REFERENCES `VoucherBatch`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `VoucherRedemption` ADD CONSTRAINT `VoucherRedemption_voucherId_fkey` FOREIGN KEY (`voucherId`) REFERENCES `Voucher`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE `Transaction` ADD COLUMN `method` VARCHAR(191) NULL;

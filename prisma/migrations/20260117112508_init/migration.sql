/*
  Warnings:

  - A unique constraint covering the columns `[inviteToken]` on the table `user` will be added. If there are existing duplicate values, this will fail.

*/
-- DropForeignKey
ALTER TABLE `document` DROP FOREIGN KEY `Document_userId_fkey`;

-- AlterTable
ALTER TABLE `document` ADD COLUMN `invoiceId` INTEGER NULL,
    ADD COLUMN `leaseId` INTEGER NULL,
    ADD COLUMN `propertyId` INTEGER NULL,
    ADD COLUMN `unitId` INTEGER NULL,
    MODIFY `userId` INTEGER NULL;

-- AlterTable
ALTER TABLE `insurance` ADD COLUMN `coverageType` VARCHAR(191) NULL,
    ADD COLUMN `leaseId` INTEGER NULL,
    ADD COLUMN `rejectionReason` TEXT NULL,
    ADD COLUMN `status` ENUM('PENDING_APPROVAL', 'ACTIVE', 'EXPIRING', 'EXPIRED', 'REJECTED') NOT NULL DEFAULT 'PENDING_APPROVAL',
    ADD COLUMN `unitId` INTEGER NULL,
    ADD COLUMN `uploadedDocumentId` INTEGER NULL;

-- AlterTable
ALTER TABLE `invoice` ADD COLUMN `leaseId` INTEGER NULL,
    ADD COLUMN `leaseType` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `user` ADD COLUMN `bedroomId` INTEGER NULL,
    ADD COLUMN `buildingId` INTEGER NULL,
    ADD COLUMN `companyDetails` TEXT NULL,
    ADD COLUMN `companyName` VARCHAR(191) NULL,
    ADD COLUMN `firstName` VARCHAR(191) NULL,
    ADD COLUMN `inviteExpires` DATETIME(3) NULL,
    ADD COLUMN `inviteToken` VARCHAR(191) NULL,
    ADD COLUMN `lastName` VARCHAR(191) NULL,
    ADD COLUMN `unitId` INTEGER NULL,
    MODIFY `password` VARCHAR(191) NULL;

-- CreateTable
CREATE TABLE `resident` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `tenantId` INTEGER NOT NULL,
    `firstName` VARCHAR(191) NOT NULL,
    `lastName` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `communicationlog` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `channel` VARCHAR(191) NOT NULL,
    `eventType` VARCHAR(191) NOT NULL,
    `recipient` VARCHAR(191) NOT NULL,
    `recipientId` INTEGER NULL,
    `relatedEntity` VARCHAR(191) NULL,
    `entityId` INTEGER NULL,
    `content` TEXT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'Sent',
    `timestamp` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE UNIQUE INDEX `user_inviteToken_key` ON `user`(`inviteToken`);

-- AddForeignKey
ALTER TABLE `resident` ADD CONSTRAINT `resident_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `user`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `insurance` ADD CONSTRAINT `insurance_leaseId_fkey` FOREIGN KEY (`leaseId`) REFERENCES `lease`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `insurance` ADD CONSTRAINT `insurance_unitId_fkey` FOREIGN KEY (`unitId`) REFERENCES `unit`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `insurance` ADD CONSTRAINT `insurance_uploadedDocumentId_fkey` FOREIGN KEY (`uploadedDocumentId`) REFERENCES `document`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `document` ADD CONSTRAINT `Document_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `document` ADD CONSTRAINT `document_leaseId_fkey` FOREIGN KEY (`leaseId`) REFERENCES `lease`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `document` ADD CONSTRAINT `document_unitId_fkey` FOREIGN KEY (`unitId`) REFERENCES `unit`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `document` ADD CONSTRAINT `document_propertyId_fkey` FOREIGN KEY (`propertyId`) REFERENCES `property`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `document` ADD CONSTRAINT `document_invoiceId_fkey` FOREIGN KEY (`invoiceId`) REFERENCES `invoice`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `communicationlog` ADD CONSTRAINT `communicationlog_recipientId_fkey` FOREIGN KEY (`recipientId`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `invoice` ADD CONSTRAINT `invoice_leaseId_fkey` FOREIGN KEY (`leaseId`) REFERENCES `lease`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

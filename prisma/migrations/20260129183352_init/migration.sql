/*
  Warnings:

  - You are about to drop the column `createdCount` on the `rentrun` table. All the data in the column will be lost.
  - You are about to drop the column `date` on the `rentrun` table. All the data in the column will be lost.
  - You are about to drop the column `month` on the `rentrun` table. All the data in the column will be lost.
  - You are about to drop the column `leaseId` on the `rentrunlog` table. All the data in the column will be lost.
  - You are about to drop the column `runId` on the `rentrunlog` table. All the data in the column will be lost.
  - You are about to drop the column `status` on the `rentrunlog` table. All the data in the column will be lost.
  - Added the required column `updatedAt` to the `rentrun` table without a default value. This is not possible if the table is not empty.
  - Added the required column `rentRunId` to the `rentrunlog` table without a default value. This is not possible if the table is not empty.
  - Made the column `message` on table `rentrunlog` required. This step will fail if there are existing NULL values in that column.

*/
-- DropForeignKey
ALTER TABLE `rentrunlog` DROP FOREIGN KEY `rentrunlog_runId_fkey`;

-- AlterTable
ALTER TABLE `invoice` ADD COLUMN `category` ENUM('RENT', 'SERVICE') NOT NULL DEFAULT 'RENT',
    ADD COLUMN `description` TEXT NULL;

-- AlterTable
ALTER TABLE `property` ADD COLUMN `companyId` INTEGER NULL;

-- AlterTable
ALTER TABLE `rentrun` DROP COLUMN `createdCount`,
    DROP COLUMN `date`,
    DROP COLUMN `month`,
    ADD COLUMN `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    ADD COLUMN `failedCount` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `runDate` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    ADD COLUMN `successCount` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `updatedAt` DATETIME(3) NOT NULL,
    MODIFY `status` VARCHAR(191) NOT NULL DEFAULT 'PENDING';

-- AlterTable
ALTER TABLE `rentrunlog` DROP COLUMN `leaseId`,
    DROP COLUMN `runId`,
    DROP COLUMN `status`,
    ADD COLUMN `rentRunId` INTEGER NOT NULL,
    MODIFY `message` TEXT NOT NULL;

-- AlterTable
ALTER TABLE `ticket` MODIFY `attachmentUrls` TEXT NULL;

-- AlterTable
ALTER TABLE `user` ADD COLUMN `companyId` INTEGER NULL;

-- CreateTable
CREATE TABLE `company` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,
    `primaryContactId` INTEGER NULL,
    `email` VARCHAR(191) NULL,
    `phone` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `company_name_key`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `unittype` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `unittype_name_key`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `quickbooksconfig` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` INTEGER NOT NULL,
    `accessToken` TEXT NULL,
    `refreshToken` TEXT NULL,
    `realmId` VARCHAR(191) NULL,
    `autoSync` BOOLEAN NOT NULL DEFAULT false,
    `frequency` VARCHAR(191) NOT NULL DEFAULT 'realtime',
    `accountFullUnitRent` VARCHAR(191) NULL,
    `accountBedroomRent` VARCHAR(191) NULL,
    `accountSecurityDeposit` VARCHAR(191) NULL,
    `accountLateFees` VARCHAR(191) NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `quickbooksconfig_userId_key`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `Property_companyId_fkey` ON `property`(`companyId`);

-- CreateIndex
CREATE INDEX `RentRunLog_rentRunId_fkey` ON `rentrunlog`(`rentRunId`);

-- CreateIndex
CREATE INDEX `user_companyId_fkey` ON `user`(`companyId`);

-- AddForeignKey
ALTER TABLE `user` ADD CONSTRAINT `user_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `company`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `property` ADD CONSTRAINT `property_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `company`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rentrunlog` ADD CONSTRAINT `RentRunLog_rentRunId_fkey` FOREIGN KEY (`rentRunId`) REFERENCES `rentrun`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `quickbooksconfig` ADD CONSTRAINT `quickbooksconfig_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

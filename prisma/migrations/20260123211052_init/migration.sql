/*
  Warnings:

  - You are about to drop the `resident` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE `resident` DROP FOREIGN KEY `resident_leaseId_fkey`;

-- DropForeignKey
ALTER TABLE `resident` DROP FOREIGN KEY `resident_tenantId_fkey`;

-- AlterTable
ALTER TABLE `user` ADD COLUMN `leaseId` INTEGER NULL,
    ADD COLUMN `parentId` INTEGER NULL,
    MODIFY `email` VARCHAR(191) NULL,
    MODIFY `type` ENUM('INDIVIDUAL', 'COMPANY', 'RESIDENT') NOT NULL DEFAULT 'INDIVIDUAL';

-- DropTable
DROP TABLE `resident`;

-- AddForeignKey
ALTER TABLE `user` ADD CONSTRAINT `user_parentId_fkey` FOREIGN KEY (`parentId`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user` ADD CONSTRAINT `user_leaseId_fkey` FOREIGN KEY (`leaseId`) REFERENCES `lease`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

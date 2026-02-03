/*
  Warnings:

  - You are about to drop the column `ownerId` on the `property` table. All the data in the column will be lost.
  - You are about to drop the `additional_owner` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE `additional_owner` DROP FOREIGN KEY `additional_owner_propertyId_fkey`;

-- DropForeignKey
ALTER TABLE `additional_owner` DROP FOREIGN KEY `additional_owner_userId_fkey`;

-- DropForeignKey
ALTER TABLE `property` DROP FOREIGN KEY `Property_ownerId_fkey`;

-- AlterTable
ALTER TABLE `property` DROP COLUMN `ownerId`;

-- DropTable
DROP TABLE `additional_owner`;

-- CreateTable
CREATE TABLE `_OwnerProperties` (
    `A` INTEGER NOT NULL,
    `B` INTEGER NOT NULL,

    UNIQUE INDEX `_OwnerProperties_AB_unique`(`A`, `B`),
    INDEX `_OwnerProperties_B_index`(`B`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `_OwnerProperties` ADD CONSTRAINT `_OwnerProperties_A_fkey` FOREIGN KEY (`A`) REFERENCES `property`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `_OwnerProperties` ADD CONSTRAINT `_OwnerProperties_B_fkey` FOREIGN KEY (`B`) REFERENCES `user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

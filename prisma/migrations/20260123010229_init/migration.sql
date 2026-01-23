/*
  Warnings:

  - The values [RESIDENT] on the enum `user_type` will be removed. If these variants are still used in the database, this will fail.

*/
-- AlterTable
ALTER TABLE `lease` ADD COLUMN `bedroomId` INTEGER NULL,
    ADD COLUMN `leaseType` ENUM('FULL_UNIT', 'BEDROOM') NOT NULL DEFAULT 'FULL_UNIT';

-- AlterTable
ALTER TABLE `user` MODIFY `type` ENUM('INDIVIDUAL', 'COMPANY') NOT NULL DEFAULT 'INDIVIDUAL';

-- AddForeignKey
ALTER TABLE `lease` ADD CONSTRAINT `lease_bedroomId_fkey` FOREIGN KEY (`bedroomId`) REFERENCES `bedroom`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

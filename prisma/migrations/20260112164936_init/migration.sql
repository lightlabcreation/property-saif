-- AlterTable
ALTER TABLE `lease` ADD COLUMN `securityDeposit` DECIMAL(65, 30) NULL,
    MODIFY `startDate` DATETIME(3) NULL,
    MODIFY `endDate` DATETIME(3) NULL,
    MODIFY `monthlyRent` DECIMAL(65, 30) NULL;

-- AlterTable
ALTER TABLE `ticket` ADD COLUMN `propertyId` INTEGER NULL,
    ADD COLUMN `unitId` INTEGER NULL;

-- AlterTable
ALTER TABLE `unit` ADD COLUMN `rentalMode` ENUM('FULL_UNIT', 'BEDROOM_WISE') NOT NULL DEFAULT 'FULL_UNIT';

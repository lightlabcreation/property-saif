-- AlterTable
ALTER TABLE `property` ADD COLUMN `city` VARCHAR(191) NULL,
    ADD COLUMN `civicNumber` VARCHAR(191) NULL,
    ADD COLUMN `postalCode` VARCHAR(191) NULL,
    ADD COLUMN `province` VARCHAR(191) NULL,
    ADD COLUMN `street` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `unit` ADD COLUMN `floor` INTEGER NULL,
    ADD COLUMN `unitNumber` VARCHAR(191) NULL,
    ADD COLUMN `unitType` VARCHAR(191) NULL;

-- CreateTable
CREATE TABLE `bedroom` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `bedroomNumber` VARCHAR(191) NOT NULL,
    `roomNumber` INTEGER NOT NULL,
    `unitId` INTEGER NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'Vacant',
    `rentAmount` DECIMAL(65, 30) NOT NULL DEFAULT 0.00,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Bedroom_unitId_fkey`(`unitId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `bedroom` ADD CONSTRAINT `Bedroom_unitId_fkey` FOREIGN KEY (`unitId`) REFERENCES `unit`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

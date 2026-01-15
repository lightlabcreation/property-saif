-- AlterTable
ALTER TABLE `lease` ADD COLUMN `bedroomId` INTEGER NULL;

-- CreateIndex
CREATE INDEX `Lease_bedroomId_fkey` ON `lease`(`bedroomId`);

-- AddForeignKey
ALTER TABLE `lease` ADD CONSTRAINT `Lease_bedroomId_fkey` FOREIGN KEY (`bedroomId`) REFERENCES `bedroom`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

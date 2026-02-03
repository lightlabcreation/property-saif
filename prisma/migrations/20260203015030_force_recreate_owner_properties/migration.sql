-- Drop the table if it exists to handle casing conflicts or local overrides
DROP TABLE IF EXISTS `_OwnerProperties`;

-- Create the table explicitly with CamelCase
CREATE TABLE `_OwnerProperties` (
    `A` INTEGER NOT NULL,
    `B` INTEGER NOT NULL,

    UNIQUE INDEX `_OwnerProperties_AB_unique`(`A`, `B`),
    INDEX `_OwnerProperties_B_index`(`B`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Add foreign keys
ALTER TABLE `_OwnerProperties` ADD CONSTRAINT `_OwnerProperties_A_fkey` FOREIGN KEY (`A`) REFERENCES `property`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `_OwnerProperties` ADD CONSTRAINT `_OwnerProperties_B_fkey` FOREIGN KEY (`B`) REFERENCES `user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
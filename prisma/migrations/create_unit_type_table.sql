-- Create UnitType table
CREATE TABLE IF NOT EXISTS `unittype` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(191) NOT NULL,
  `isActive` BOOLEAN NOT NULL DEFAULT true,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `unittype_name_key`(`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Seed default unit types
INSERT INTO `unittype` (`name`, `isActive`) VALUES
('Apartment', true),
('Condo', true),
('Studio', true),
('Townhouse', true),
('Loft', true),
('Duplex', true),
('Penthouse', true)
ON DUPLICATE KEY UPDATE `name` = VALUES(`name`);

-- RedefineIndex
CREATE UNIQUE INDEX `_ownerproperties_AB_unique` ON `_ownerproperties`(`A`, `B`);
DROP INDEX `_OwnerProperties_AB_unique` ON `_ownerproperties`;

-- RedefineIndex
CREATE INDEX `_ownerproperties_B_index` ON `_ownerproperties`(`B`);
DROP INDEX `_OwnerProperties_B_index` ON `_ownerproperties`;

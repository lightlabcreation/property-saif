const prisma = require('../../config/prisma');

// GET /api/admin/units
exports.getAllUnits = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const skip = (page - 1) * limit;

        const propertyId = req.query.propertyId ? parseInt(req.query.propertyId) : undefined;
        const rentalMode = req.query.rentalMode;

        const where = {};
        if (propertyId) where.propertyId = propertyId;
        if (rentalMode) where.rentalMode = rentalMode;

        const [units, total] = await Promise.all([
            prisma.unit.findMany({
                where,
                include: { property: true },
                skip,
                take: limit,
                orderBy: { createdAt: 'desc' }
            }),
            prisma.unit.count({ where })
        ]);

        const formatted = units.map(u => ({
            id: u.id,
            unitNumber: u.unitNumber || u.name,
            unitType: u.unitType,
            floor: u.floor,
            civicNumber: u.property.civicNumber,
            building: u.property.civicNumber || u.property.name,
            status: u.status,
            propertyId: u.propertyId,
            bedrooms: u.bedrooms
        }));

        res.json({
            data: formatted,
            pagination: {
                total,
                page,
                limit,
                totalPages: Math.ceil(total / limit)
            }
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
};


// POST /api/admin/units
exports.createUnit = async (req, res) => {
    try {
        const { unit: unitName, propertyId, rentalMode, unitNumber, unitType, floor, bedrooms: bedroomCount } = req.body;

        if (!propertyId) {
            return res.status(400).json({ message: 'Property (Building) is required' });
        }

        const finalPropertyId = parseInt(propertyId);

        // Final sanity check if property exists
        const property = await prisma.property.findUnique({ where: { id: finalPropertyId } });
        if (!property) return res.status(404).json({ message: 'Property not found' });

        // Normalize rentalMode from frontend (could be 1, 3, or labels)
        let normalizedMode = 'FULL_UNIT';
        if (rentalMode === 3 || rentalMode === '3' || rentalMode === 'Bedroom-wise' || rentalMode === 'BEDROOM_WISE') {
            normalizedMode = 'BEDROOM_WISE';
        } else if (rentalMode === 1 || rentalMode === '1' || rentalMode === 'Full Unit' || rentalMode === 'FULL_UNIT') {
            normalizedMode = 'FULL_UNIT';
        }

        // Determine number of bedrooms
        const numBedrooms = parseInt(bedroomCount) || (normalizedMode === 'BEDROOM_WISE' ? 3 : 1);

        // Create the unit with new fields
        const newUnit = await prisma.unit.create({
            data: {
                name: unitName,
                unitNumber: unitNumber || unitName,
                unitType: unitType || null,
                floor: floor ? parseInt(floor) : null,
                propertyId: parseInt(finalPropertyId),
                status: 'Vacant',
                rentalMode: normalizedMode,
                bedrooms: numBedrooms,
                rentAmount: 0
            },
            include: { property: true }
        });

        // If BEDROOM_WISE, create individual bedroom records
        if (normalizedMode === 'BEDROOM_WISE' && numBedrooms > 0) {
            const bedroomsToCreate = Array.from({ length: numBedrooms }).map((_, i) => ({
                bedroomNumber: `${newUnit.unitNumber || newUnit.name}-${i + 1}`,
                roomNumber: i + 1,
                unitId: newUnit.id,
                status: 'Vacant',
                rentAmount: 0
            }));

            await prisma.bedroom.createMany({
                data: bedroomsToCreate
            });
        }

        // Format exactly as frontend expects for the list
        const formatted = {
            id: newUnit.id,
            unitNumber: newUnit.unitNumber || newUnit.name,
            unitType: newUnit.unitType,
            floor: newUnit.floor,
            civicNumber: newUnit.property.civicNumber,
            building: newUnit.property.civicNumber || newUnit.property.name,
            status: newUnit.status,
            propertyId: newUnit.propertyId,
            bedrooms: newUnit.bedrooms
        };

        res.status(201).json(formatted);
    } catch (error) {
        console.error('Create Unit Error:', error);
        res.status(500).json({ message: 'Error creating unit' });
    }
};

// GET /api/admin/units/:id
exports.getUnitDetails = async (req, res) => {
    try {
        const { id } = req.params;
        const unit = await prisma.unit.findUnique({
            where: { id: parseInt(id) },
            include: {
                property: true,
                leases: {
                    include: { tenant: true },
                    orderBy: { startDate: 'desc' }
                },
                bedroomsList: true
            }
        });

        if (!unit) return res.status(404).json({ message: 'Unit not found' });

        const activeLease = unit.leases.find(l => l.status === 'Active');
        const history = unit.leases.filter(l => l.status !== 'Active');

        // Transform to match frontend Skeleton needs
        res.json({
            id: unit.id,
            unitNumber: unit.unitNumber || unit.name,
            unitType: unit.unitType,
            civicNumber: unit.property.civicNumber,
            building: unit.property.civicNumber || unit.property.name,
            propertyId: unit.propertyId,
            floor: unit.floor,
            status: unit.status,
            bedrooms: unit.bedrooms,
            bedroomsList: unit.bedroomsList.map(b => ({
                id: b.id,
                bedroomNumber: b.bedroomNumber,
                roomNumber: b.roomNumber,
                status: b.status,
                rentAmount: b.rentAmount
            })),
            activeLease: activeLease ? {
                tenantName: activeLease.tenant.name,
                startDate: activeLease.startDate,
                endDate: activeLease.endDate,
                amount: activeLease.monthlyRent
            } : null,
            tenantHistory: history.map(h => ({
                id: h.id,
                tenantName: h.tenant.name,
                startDate: h.startDate,
                endDate: h.endDate
            }))
        });

    } catch (error) {
        console.error('Get Unit Details Error:', error);
        res.status(500).json({ message: 'Server error' });
    }
};

// PUT /api/admin/units/:id
exports.updateUnit = async (req, res) => {
    try {
        const { id } = req.params;
        const { unitNumber, unitType, floor, bedrooms, rentalMode, status, propertyId } = req.body;

        const existingUnit = await prisma.unit.findUnique({
            where: { id: parseInt(id) },
            include: { bedroomsList: true }
        });

        if (!existingUnit) {
            return res.status(404).json({ message: 'Unit not found' });
        }

        // Normalize rentalMode
        let normalizedMode = existingUnit.rentalMode;
        if (rentalMode === 'BEDROOM_WISE' || rentalMode === 'Bedroom-wise') {
            normalizedMode = 'BEDROOM_WISE';
        } else if (rentalMode === 'FULL_UNIT' || rentalMode === 'Full Unit') {
            normalizedMode = 'FULL_UNIT';
        }

        const numBedrooms = parseInt(bedrooms) || existingUnit.bedrooms;

        // Update the unit
        const updatedUnit = await prisma.unit.update({
            where: { id: parseInt(id) },
            data: {
                unitNumber: unitNumber || existingUnit.unitNumber,
                unitType: unitType || existingUnit.unitType,
                floor: floor ? parseInt(floor) : existingUnit.floor,
                bedrooms: numBedrooms,
                rentalMode: normalizedMode,
                status: status || existingUnit.status,
                propertyId: propertyId ? parseInt(propertyId) : existingUnit.propertyId
            },
            include: { property: true }
        });

        // Handle bedroom records if mode changed to BEDROOM_WISE or bedroom count changed
        if (normalizedMode === 'BEDROOM_WISE') {
            const currentBedroomCount = existingUnit.bedroomsList.length;

            if (numBedrooms > currentBedroomCount) {
                // Add more bedrooms
                const bedroomsToAdd = Array.from({ length: numBedrooms - currentBedroomCount }).map((_, i) => ({
                    bedroomNumber: `${updatedUnit.unitNumber}-${currentBedroomCount + i + 1}`,
                    roomNumber: currentBedroomCount + i + 1,
                    unitId: updatedUnit.id,
                    status: 'Vacant',
                    rentAmount: 0
                }));
                await prisma.bedroom.createMany({ data: bedroomsToAdd });
            } else if (numBedrooms < currentBedroomCount) {
                // Remove excess bedrooms (only vacant ones)
                const bedroomsToRemove = existingUnit.bedroomsList
                    .filter(b => b.status === 'Vacant')
                    .slice(0, currentBedroomCount - numBedrooms);

                if (bedroomsToRemove.length > 0) {
                    await prisma.bedroom.deleteMany({
                        where: { id: { in: bedroomsToRemove.map(b => b.id) } }
                    });
                }
            }
        }

        // Format response
        const formatted = {
            id: updatedUnit.id,
            unitNumber: updatedUnit.unitNumber || updatedUnit.name,
            unitType: updatedUnit.unitType,
            floor: updatedUnit.floor,
            civicNumber: updatedUnit.property.civicNumber,
            building: updatedUnit.property.civicNumber || updatedUnit.property.name,
            propertyId: updatedUnit.propertyId,
            status: updatedUnit.status,
            bedrooms: updatedUnit.bedrooms
        };

        res.json(formatted);
    } catch (error) {
        console.error('Update Unit Error:', error);
        res.status(500).json({ message: 'Error updating unit' });
    }
};

// GET /api/admin/units/bedrooms/vacant
exports.getVacantBedrooms = async (req, res) => {
    try {
        const propertyId = req.query.propertyId ? parseInt(req.query.propertyId) : undefined;

        // Build where clause for units
        const unitWhere = {};
        if (propertyId) unitWhere.propertyId = propertyId;

        // Fetch all bedrooms with their unit and property info
        const bedrooms = await prisma.bedroom.findMany({
            where: {
                status: 'Vacant',
                unit: unitWhere
            },
            include: {
                unit: {
                    include: {
                        property: true
                    }
                }
            },
            orderBy: [
                { unit: { propertyId: 'asc' } },
                { unitId: 'asc' },
                { roomNumber: 'asc' }
            ]
        });

        // Format bedrooms for dropdown: civicNumber-unitNumber-roomNumber (e.g., 82-101-1)
        const formatted = bedrooms.map(b => ({
            id: b.id,
            bedroomNumber: b.bedroomNumber,
            displayName: `${b.unit.property.civicNumber}-${b.unit.unitNumber}-${b.roomNumber}`,
            civicNumber: b.unit.property.civicNumber,
            unitNumber: b.unit.unitNumber,
            roomNumber: b.roomNumber,
            floor: b.unit.floor,
            unitId: b.unitId,
            propertyId: b.unit.propertyId,
            status: b.status
        }));

        res.json(formatted);
    } catch (error) {
        console.error('Get Vacant Bedrooms Error:', error);
        res.status(500).json({ message: 'Server error' });
    }
};

// DELETE /api/admin/units/:id
exports.deleteUnit = async (req, res) => {
    try {
        const { id } = req.params;
        const unitId = parseInt(id);

        const unit = await prisma.unit.findUnique({
            where: { id: unitId },
            include: { leases: true, bedroomsList: true }
        });

        if (!unit) {
            return res.status(404).json({ message: 'Unit not found' });
        }

        // Check for active leases
        const hasActiveLease = unit.leases.some(l => l.status === 'Active');
        if (hasActiveLease) {
            return res.status(400).json({ message: 'Cannot delete unit with active lease' });
        }

        // Use transaction to delete all related records
        await prisma.$transaction(async (tx) => {
            // Delete associated invoices first (FK constraint)
            await tx.invoice.deleteMany({
                where: { unitId: unitId }
            });

            // Delete associated refund adjustments (FK constraint)
            await tx.refundAdjustment.deleteMany({
                where: { unitId: unitId }
            });

            // Delete associated bedrooms
            await tx.bedroom.deleteMany({
                where: { unitId: unitId }
            });

            // Delete associated leases (non-active)
            await tx.lease.deleteMany({
                where: { unitId: unitId }
            });

            // Delete the unit
            await tx.unit.delete({
                where: { id: unitId }
            });
        });

        res.json({ message: 'Unit deleted successfully' });
    } catch (error) {
        console.error('Delete Unit Error:', error);
        res.status(500).json({ message: 'Error deleting unit' });
    }
};


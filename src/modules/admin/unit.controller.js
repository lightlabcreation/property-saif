const prisma = require('../../config/prisma');

// GET /api/admin/units
exports.getAllUnits = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const skip = (page - 1) * limit;

        const propertyId = (req.query.propertyId || req.query.building_id) ? parseInt(req.query.propertyId || req.query.building_id) : undefined;
        const rentalMode = req.query.rentalMode;

        const where = {};
        if (propertyId) where.propertyId = propertyId;
        if (rentalMode) where.rentalMode = rentalMode;

        const [units, total] = await Promise.all([
            prisma.unit.findMany({
                where,
                include: {
                    property: true,
                    leases: {
                        where: { status: 'Active' },
                        select: {
                            id: true,
                            status: true,
                            tenant: { select: { type: true } },
                            startDate: true,
                            endDate: true,
                            monthlyRent: true,
                            securityDeposit: true
                        }
                    }
                },
                skip,
                take: limit,
                orderBy: { createdAt: 'desc' }
            }),
            prisma.unit.count({ where })
        ]);

        const formatted = units.map(u => {
            // Format unit identifier as: {civicNumber}-{unitNumber} (e.g. 91-101)
            const unitIdentifier = u.property.civicNumber && u.unitNumber
                ? `${u.property.civicNumber}-${u.unitNumber}`
                : u.unitNumber || u.name;

            return {
                id: u.id,
                unitNumber: u.unitNumber || u.name,
                unit_identifier: unitIdentifier,
                unitIdentifier: unitIdentifier, // Alias for consistency
                unitType: u.unitType,
                floor: u.floor,
                civicNumber: u.property.civicNumber,
                building: u.property.civicNumber || u.property.name,
                buildingName: u.property.name,
                status: u.status,
                propertyId: u.propertyId,
                bedrooms: u.bedrooms,
                rentalMode: u.rentalMode,
                activeLeaseCount: u.leases ? u.leases.length : 0,
                activeLeaseCount: u.leases ? u.leases.length : 0,
                hasCompanyLease: u.leases ? u.leases.some(l => l.tenant.type === 'COMPANY') : false,
                companyLeaseDetails: u.leases ? u.leases.find(l => l.tenant.type === 'COMPANY') : null,
                draftLeaseCount: 0, // Simplified
                activeLeases: u.leases ? u.leases.length : 0
            };
        });

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
        const { unit: unitName, propertyId, rentalMode, unitNumber, unitType, floor, bedrooms: bedroomCount, bedroomIdentifiers } = req.body;

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

        // Validate unit type if provided (Check against DB)
        if (unitType) {
            const validType = await prisma.unitType.findUnique({
                where: { name: unitType }
            });
            if (!validType) {
                return res.status(400).json({
                    message: `Invalid unit type: ${unitType}. Please use a valid unit type.`
                });
            }
        }

        // Create the unit with new fields
        const newUnit = await prisma.unit.create({
            data: {
                name: unitName || unitNumber, // Fallback if name removed from frontend
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

        // If bedrooms exist (regardless of mode, if count > 0), create records
        if (numBedrooms > 0) {
            let bedroomsToCreate = [];

            const civic = newUnit.property.civicNumber || '';
            const uNum = newUnit.unitNumber || newUnit.name;

            // Normalize all bedrooms to {BuildingCivicNumber}-{UnitNumber}-{BedroomSequence}
            // BUT if bedroomIdentifiers are provided (custom names), use them
            bedroomsToCreate = Array.from({ length: numBedrooms }).map((_, i) => {
                let identifier = `${civic}-${uNum}-${i + 1}`;

                // Use custom identifier if provided
                if (Array.isArray(bedroomIdentifiers) && bedroomIdentifiers[i]) {
                    identifier = bedroomIdentifiers[i];
                }

                return {
                    bedroomNumber: identifier,
                    roomNumber: i + 1,
                    unitId: newUnit.id,
                    status: 'Vacant',
                    rentAmount: 0
                };
            });

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
        const uId = parseInt(id);

        const unit = await prisma.unit.findUnique({
            where: { id: uId },
            include: {
                property: true,
                leases: {
                    include: { tenant: true },
                    orderBy: { startDate: 'desc' }
                },
                bedroomsList: {
                    orderBy: { roomNumber: 'asc' }
                }
            }
        });

        if (!unit) return res.status(404).json({ message: 'Unit not found' });

        // Fetch occupants separately
        const occupants = await prisma.user.findMany({
            where: {
                unitId: uId,
                role: 'TENANT',
                type: 'RESIDENT'
            },
            select: {
                id: true,
                name: true,
                firstName: true,
                lastName: true,
                email: true,
                phone: true,
                bedroomId: true
            }
        });

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
            rentalMode: unit.rentalMode, // Added rentalMode to response
            bedroomsList: unit.bedroomsList.map(b => ({
                id: b.id,
                bedroomNumber: b.bedroomNumber,
                originalBedroomNumber: b.bedroomNumber,
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
            })),
            occupants: occupants || []
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
        const { unitNumber, unitType, floor, bedrooms, rentalMode, status, propertyId, bedroomIdentifiers } = req.body;

        const existingUnit = await prisma.unit.findUnique({
            where: { id: parseInt(id) },
            include: { bedroomsList: { orderBy: { roomNumber: 'asc' } } }
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

        // Validate unit type if provided (Check against DB)
        if (unitType) {
            const validType = await prisma.unitType.findUnique({
                where: { name: unitType }
            });
            if (!validType) {
                return res.status(400).json({
                    message: `Invalid unit type: ${unitType}. Please use a valid unit type.`
                });
            }
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

        // Handle bedroom synchronisation
        // Only proceed if identifiers provided or count changed
        if (Array.isArray(bedroomIdentifiers) || numBedrooms !== existingUnit.bedroomsList.length) {
            const existingBedrooms = existingUnit.bedroomsList;

            const civic = updatedUnit.property.civicNumber || '';
            const uNum = updatedUnit.unitNumber || updatedUnit.name;

            // 1. Update existing bedrooms or create new ones up to numBedrooms
            for (let i = 0; i < numBedrooms; i++) {
                // Default auto-generated name
                let newName = `${civic}-${uNum}-${i + 1}`;

                // Use custom identifier if provided
                if (Array.isArray(bedroomIdentifiers) && bedroomIdentifiers[i]) {
                    newName = bedroomIdentifiers[i];
                }

                if (i < existingBedrooms.length) {
                    // Update existing
                    if (existingBedrooms[i].bedroomNumber !== newName) {
                        await prisma.bedroom.update({
                            where: { id: existingBedrooms[i].id },
                            data: { bedroomNumber: newName, roomNumber: i + 1 }
                        });
                    }
                } else {
                    // Create new
                    await prisma.bedroom.create({
                        data: {
                            bedroomNumber: newName,
                            roomNumber: i + 1,
                            unitId: updatedUnit.id,
                            status: 'Vacant'
                        }
                    });
                }
            }

            // 2. Remove excess bedrooms
            if (existingBedrooms.length > numBedrooms) {
                const toDelete = existingBedrooms.slice(numBedrooms);
                // Try to delete. Only deletes if no foreign key constraints (empty bedrooms) typically
                try {
                    await prisma.bedroom.deleteMany({
                        where: { id: { in: toDelete.map(b => b.id) } }
                    });
                } catch (e) {
                    console.warn("Could not delete some excess bedrooms, likely in use.");
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
        const unitId = req.query.unitId ? parseInt(req.query.unitId) : undefined;
        const includeId = req.query.includeId ? parseInt(req.query.includeId) : undefined;

        // 1. Find bedrooms already assigned to users (residents/occupants)
        const usersWithBedrooms = await prisma.user.findMany({
            where: { bedroomId: { not: null } },
            select: { bedroomId: true }
        });
        const takenByUser = usersWithBedrooms.map(u => u.bedroomId);

        // 2. Find bedrooms with active/draft individual leases
        const activeBedroomLeases = await prisma.lease.findMany({
            where: {
                bedroomId: { not: null },
                status: { in: ['Active', 'DRAFT'] }
            },
            select: { bedroomId: true }
        });
        const takenByLease = activeBedroomLeases.map(l => l.bedroomId);

        // Combine all taken IDs
        let takenIds = [...new Set([...takenByUser, ...takenByLease])];

        // If editing, allow the current bedroom to remain in the list
        if (includeId) {
            takenIds = takenIds.filter(id => id !== includeId);
        }

        // Build where clause for units context
        const unitWhere = {};
        if (propertyId) unitWhere.propertyId = propertyId;
        if (unitId) unitWhere.id = unitId;

        // Fetch bedrooms that match the context AND are not in takenIds
        const bedrooms = await prisma.bedroom.findMany({
            where: {
                id: { notIn: takenIds },
                unit: unitWhere,
                OR: [
                    { status: 'Vacant' },
                    {
                        unit: {
                            leases: {
                                some: {
                                    status: 'Active',
                                    tenant: { type: 'COMPANY' }
                                }
                            }
                        }
                    },
                    // If we specifically requested a unit, show its UNTAKEN bedrooms
                    { unitId: unitId ? unitId : -1 }
                ]
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

        // Format bedrooms for dropdown
        const formatted = bedrooms.map(b => ({
            id: b.id,
            bedroomNumber: b.bedroomNumber,
            originalBedroomNumber: b.bedroomNumber,
            displayName: `${b.unit.property.name}-${b.unit.property.civicNumber || ''}-${b.unit.unitNumber || b.unit.name}-${b.roomNumber}`,
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
        const result = await prisma.$transaction(async (tx) => {
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

            return { message: 'Unit deleted successfully' };
        });

        res.json(result);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
};

// GET /api/admin/unit-types
// GET /api/admin/unit-types
exports.getUnitTypes = async (req, res) => {
    try {
        // Fetch from DB
        const unitTypes = await prisma.unitType.findMany({
            orderBy: { name: 'asc' }
        });

        res.json({
            unitTypes: unitTypes.map(t => ({ id: t.id, name: t.name, isActive: t.isActive }))
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
};

// POST /api/admin/unit-types
exports.createUnitType = async (req, res) => {
    try {
        const { name } = req.body;

        if (!name) return res.status(400).json({ message: 'Name is required' });

        const existing = await prisma.unitType.findUnique({
            where: { name }
        });

        if (existing) {
            return res.status(400).json({ message: 'Unit Type already exists' });
        }

        const newType = await prisma.unitType.create({
            data: { name, isActive: true }
        });

        res.status(201).json(newType);
    } catch (error) {
        console.error('Create Unit Type Error:', error);
        res.status(500).json({ message: 'Server error' });
    }
};

// DELETE /api/admin/unit-types/:id
exports.deleteUnitType = async (req, res) => {
    try {
        const { id } = req.params;

        await prisma.unitType.delete({
            where: { id: parseInt(id) }
        });

        res.json({ message: 'Unit Type deleted' });
    } catch (error) {
        console.error('Delete Unit Type Error:', error);
        res.status(500).json({ message: 'Server error' });
    }
};

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
            unitNumber: u.name,
            building: u.property.name,
            rentalMode: u.rentalMode,
            status: u.status,
            propertyId: u.propertyId
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
        const { unit: unitName, propertyId, rentalMode } = req.body;

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

        const newUnit = await prisma.unit.create({
            data: {
                name: unitName,
                propertyId: parseInt(finalPropertyId),
                status: 'Vacant',
                rentalMode: normalizedMode,
                bedrooms: normalizedMode === 'BEDROOM_WISE' ? 3 : 1, // keeping bedroom count for other heuristics
                rentAmount: 0
            },
            include: { property: true }
        });

        // Format exactly as frontend expects for the list
        const formatted = {
            id: newUnit.id,
            unitNumber: newUnit.name,
            building: newUnit.property.name,
            rentalMode: newUnit.rentalMode,
            status: newUnit.status
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
                }
            }
        });

        if (!unit) return res.status(404).json({ message: 'Unit not found' });

        const activeLease = unit.leases.find(l => l.status === 'Active');
        const history = unit.leases.filter(l => l.status !== 'Active');

        // Transform to match frontend Skeleton needs
        res.json({
            id: unit.id,
            unitNumber: unit.name,
            building: unit.property.name,
            floor: 'N/A', // Schema missing floor
            rentalMode: unit.rentalMode,
            status: unit.status,
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


const prisma = require('../../config/prisma');
const bcrypt = require('bcrypt'); // Added bcrypt

exports.getDashboardStats = async (req, res) => {
    // ... existing getDashboardStats code ...

    try {
        // 1. Total Properties
        const totalProperties = await prisma.property.count();

        // 2. Total Units
        const totalUnits = await prisma.unit.count();

        // 3. Occupancy (Occupied vs Vacant)
        const occupiedUnits = await prisma.unit.count({
            where: { status: 'Occupied' },
        });
        const vacantUnits = totalUnits - occupiedUnits;

        // 4. Revenue Calculation (Requirement 7)
        // Projected Revenue = Sum of rent from all active leases
        const leaseAgg = await prisma.lease.aggregate({
            where: { status: 'Active' },
            _sum: { monthlyRent: true }
        });
        const projectedRevenue = parseFloat(leaseAgg._sum.monthlyRent) || 0;

        // Actual Revenue = Sum of paidAmount from all invoices
        const invoiceAgg = await prisma.invoice.aggregate({
            _sum: { paidAmount: true }
        });
        const actualRevenue = parseFloat(invoiceAgg._sum.paidAmount) || 0;

        // 5. Recent Activity (Latest 5 tickets)
        const recentTickets = await prisma.ticket.findMany({
            take: 5,
            orderBy: { createdAt: 'desc' },
            include: { user: true }
        });
        const recentActivity = recentTickets.map(t => `${t.user?.name || 'Someone'} created ticket: ${t.subject}`);

        // 6. Insurance Alerts
        const today = new Date();
        const expiredInsurance = await prisma.insurance.count({
            where: { endDate: { lt: today } }
        });
        const soonDate = new Date();
        soonDate.setDate(today.getDate() + 30);
        const expiringSoon = await prisma.insurance.count({
            where: {
                endDate: { gt: today, lte: soonDate }
            }
        });

        res.json({
            totalProperties,
            totalUnits,
            occupancy: {
                occupied: occupiedUnits,
                vacant: vacantUnits,
            },
            projectedRevenue,
            actualRevenue,
            monthlyRevenue: projectedRevenue, // Backward compatibility
            insuranceAlerts: {
                expired: expiredInsurance,
                expiringSoon: expiringSoon
            },
            recentActivity,
        });
    } catch (error) {
        console.error('Dashboard Stats Error:', error);
        res.status(500).json({ message: 'Server error' });
    }
};

exports.getProperties = async (req, res) => {
    try {
        const properties = await prisma.property.findMany({
            include: {
                units: {
                    select: {
                        status: true
                    }
                }
            }
        });

        const formatted = properties.map(p => {
            const totalUnits = p.units.length;
            const occupiedCount = p.units.filter(u => u.status !== 'Vacant').length;
            const occupancyRate = totalUnits > 0 ? Math.round((occupiedCount / totalUnits) * 100) : 0;

            return {
                id: p.id,
                name: p.name,
                address: p.address,
                units: totalUnits,
                occupancy: `${occupancyRate}%`,
                status: p.status,
                ownerId: p.ownerId // Required for filtering in Owners.jsx
            };
        });

        res.json(formatted);
    } catch (error) {
        console.error('Get Properties Error:', error);
        res.status(500).json({ message: 'Server error' });
    }
};

exports.getPropertyDetails = async (req, res) => {
    try {
        const { id } = req.params;
        const propertyId = parseInt(id);

        const property = await prisma.property.findUnique({
            where: { id: propertyId },
            include: {
                units: {
                    include: {
                        leases: {
                            where: { status: 'Active' },
                            include: { tenant: true }
                        },
                        invoices: {
                            where: { status: 'paid' }
                        }
                    }
                }
            }
        });

        if (!property) return res.status(404).json({ message: 'Property not found' });

        const totalUnits = property.units.length;
        const occupiedCount = property.units.filter(u => u.status !== 'Vacant').length;
        const occupancyRate = totalUnits > 0 ? Math.round((occupiedCount / totalUnits) * 100) : 0;

        // Revenue YTD (Simple sum of all paid invoices for now as "YTD" logic can be complex without timezone)
        const totalRevenue = property.units.reduce((sum, unit) => {
            return sum + unit.invoices.reduce((isum, inv) => isum + parseFloat(inv.amount), 0);
        }, 0);

        const formattedUnits = property.units.map(u => {
            const activeLease = u.leases[0];
            return {
                id: u.id,
                name: u.name,
                type: u.bedrooms + 'BHK',
                mode: u.rentalMode, // Returns FULL_UNIT or BEDROOM_WISE
                status: u.status,
                tenant: activeLease ? activeLease.tenant.name : '-'
            };
        });

        res.json({
            name: property.name,
            totalUnits,
            occupancyRate,
            revenue: totalRevenue,
            units: formattedUnits
        });

    } catch (error) {
        console.error('Get Property Details Error:', error);
        res.status(500).json({ message: 'Server error' });
    }
};

exports.createProperty = async (req, res) => {
    try {
        const { name, units, status, ownerId, address } = req.body;

        // Create property with auto-generated units to match the count
        const property = await prisma.property.create({
            data: {
                name,
                status,
                address: address || "Not Provided",
                ownerId: ownerId ? parseInt(ownerId) : null,
                units: {
                    create: Array.from({ length: parseInt(units) || 0 }).map((_, i) => ({
                        name: `Unit ${i + 1}`,
                        status: 'Vacant'
                    }))
                }
            },
            include: { units: true, owner: true }
        });

        res.json({
            id: property.id,
            name: property.name,
            units: property.units.length,
            status: property.status,
            ownerName: property.owner?.name
        });
    } catch (error) {
        console.error('Create Property Error:', error);
        res.status(500).json({ message: 'Server error' });
    }
};

exports.updateProperty = async (req, res) => {
    try {
        const { id } = req.params;
        const { name, units, status } = req.body;

        // First, get the current property to check unit count
        const currentProperty = await prisma.property.findUnique({
            where: { id: parseInt(id) },
            include: { units: true }
        });

        if (!currentProperty) {
            return res.status(404).json({ message: 'Property not found' });
        }

        // Update property name and status
        await prisma.property.update({
            where: { id: parseInt(id) },
            data: {
                name,
                status
            }
        });

        // Handle unit count changes
        const currentCount = currentProperty.units.length;
        const targetCount = parseInt(units);

        if (targetCount > currentCount) {
            // Add new units
            const unitsToAdd = targetCount - currentCount;
            await prisma.unit.createMany({
                data: Array.from({ length: unitsToAdd }).map((_, i) => ({
                    name: `Unit ${currentCount + i + 1}`,
                    propertyId: parseInt(id),
                    status: 'Vacant'
                }))
            });
        } else if (targetCount < currentCount) {
            // Remove excess vacant units (only remove vacant units to avoid data loss)
            const unitsToRemove = currentCount - targetCount;
            const vacantUnits = currentProperty.units
                .filter(u => u.status === 'Vacant')
                .slice(0, unitsToRemove);

            if (vacantUnits.length > 0) {
                await prisma.unit.deleteMany({
                    where: {
                        id: { in: vacantUnits.map(u => u.id) }
                    }
                });
            }
        }

        // Refetch to get updated property with current unit count
        const updatedProperty = await prisma.property.findUnique({
            where: { id: parseInt(id) },
            include: { units: true }
        });

        res.json({
            id: updatedProperty.id,
            name: updatedProperty.name,
            units: updatedProperty.units.length,
            status: updatedProperty.status
        });

    } catch (error) {
        console.error('Update Property Error:', error);
        res.status(500).json({ message: 'Server error' });
    }
};

exports.deleteProperty = async (req, res) => {
    try {
        const { id } = req.params;

        // Need to delete related units first (Prisma doesn't auto-cascade unless configured in schema)
        // Also other relations... for now trying deletion of units then property.
        await prisma.unit.deleteMany({
            where: { propertyId: parseInt(id) }
        });

        await prisma.property.delete({
            where: { id: parseInt(id) }
        });

        res.json({ message: 'Property deleted successfully' });
    } catch (error) {
        console.error('Delete Property Error:', error);
        res.status(500).json({ message: 'Server error' });
    }
};

exports.getOwners = async (req, res) => {
    try {
        const owners = await prisma.user.findMany({
            where: { role: 'OWNER' },
            include: {
                properties: {
                    include: { units: true }
                }
            }
        });

        const formatted = owners.map(o => {
            const totalUnits = o.properties.reduce((acc, p) => acc + p.units.length, 0);
            const propertyNames = o.properties.map(p => p.name);
            return {
                id: o.id,
                name: o.name,
                email: o.email,
                phone: o.phone,
                properties: propertyNames,
                totalUnits,
                status: 'Active'
            };
        });

        res.json(formatted);
    } catch (error) {
        console.error('Get Owners Error:', error);
        res.status(500).json({ message: 'Server error' });
    }
};

exports.createOwner = async (req, res) => {
    try {
        const { name, email, phone, password, propertyIds } = req.body;

        const existing = await prisma.user.findUnique({ where: { email } });
        if (existing) return res.status(400).json({ message: 'Email already exists' });

        const hashedPassword = await bcrypt.hash(password, 10);

        const newOwner = await prisma.user.create({
            data: {
                name,
                email,
                phone,
                password: hashedPassword,
                role: 'OWNER',
                properties: {
                    connect: propertyIds?.map(id => ({ id })) || []
                }
            }
        });

        res.status(201).json(newOwner);
    } catch (error) {
        console.error('Create Owner Error:', error);
        res.status(500).json({ message: 'Server error' });
    }
};

exports.updateOwner = async (req, res) => {
    try {
        const { id } = req.params;
        const { name, email, phone, propertyIds } = req.body;

        const updateData = {
            name,
            email,
            phone,
            properties: {
                set: propertyIds?.map(pid => ({ id: pid })) || []
            }
        };

        const updated = await prisma.user.update({
            where: { id: parseInt(id) },
            data: updateData
        });

        res.json(updated);
    } catch (error) {
        console.error('Update Owner Error:', error);
        res.status(500).json({ message: 'Server error' });
    }
};

exports.deleteOwner = async (req, res) => {
    try {
        const { id } = req.params;

        // Disconnect properties first
        await prisma.property.updateMany({
            where: { ownerId: parseInt(id) },
            data: { ownerId: null }
        });

        await prisma.user.delete({
            where: { id: parseInt(id) }
        });

        res.json({ message: 'Owner deleted' });
    } catch (error) {
        console.error('Delete Owner Error:', error);
        res.status(500).json({ message: 'Server error' });
    }
};

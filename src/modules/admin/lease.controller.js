const prisma = require('../../config/prisma');

// GET /api/admin/leases
exports.getLeaseHistory = async (req, res) => {
    try {
        const leases = await prisma.lease.findMany({
            where: {
                startDate: { not: null },
                endDate: { not: null }
            },
            include: {
                tenant: true,
                unit: true
            },
            orderBy: { startDate: 'desc' }
        });

        const formatted = leases.map(l => ({
            id: l.id,
            unit: l.unit.name,
            type: l.unit.rentalMode, // Uses FULL_UNIT or BEDROOM_WISE
            scope: l.unit.rentalMode === 'BEDROOM_WISE' ? 'Per Bedroom' : 'Monthly',
            tenant: l.tenant.name,
            term: l.startDate && l.endDate
                ? `${l.startDate.toISOString().substring(0, 7)} - ${l.endDate.toISOString().substring(0, 7)}`
                : 'Date Pending (DRAFT)',
            status: l.status.toLowerCase(),
            startDate: l.startDate,
            endDate: l.endDate,
            monthlyRent: l.monthlyRent || 0
        }));

        res.json(formatted);
    } catch (e) {
        console.error(e);
        res.status(500).json({ message: 'Server error' });
    }
};

// DELETE /api/admin/leases/:id
exports.deleteLease = async (req, res) => {
    try {
        await prisma.lease.delete({ where: { id: parseInt(req.params.id) } });
        res.json({ message: 'Deleted' });
    } catch (e) {
        res.status(500).json({ message: 'Error' });
    }
};

// PUT /api/admin/leases/:id (Basic update)
exports.updateLease = async (req, res) => {
    try {
        res.json(req.body);
    } catch (e) {
        res.status(500).json({ message: 'Error' });
    }
};

// GET /api/admin/leases/active/:unitId
exports.getActiveLease = async (req, res) => {
    try {
        const { unitId } = req.params;
        const activeLease = await prisma.lease.findFirst({
            where: {
                unitId: parseInt(unitId),
                status: { in: ['Active', 'DRAFT'] }
            },
            include: {
                tenant: true
            }
        });

        if (!activeLease) {
            return res.json(null);
        }

        res.json({
            tenantId: activeLease.tenantId,
            tenantName: activeLease.tenant.name
        });
    } catch (error) {
        console.error('Get Active Lease Error:', error);
        res.status(500).json({ message: 'Server error' });
    }
};

// POST /api/admin/leases
exports.createLease = async (req, res) => {
    try {
        const { unitId, tenantName, startDate, endDate, monthlyRent, securityDeposit } = req.body;

        if (!unitId || !tenantName) {
            return res.status(400).json({ message: 'Unit and Tenant Name are required' });
        }

        const uId = parseInt(unitId);

        // Find tenant by name (simplification based on requirement 2: "Tenant data must come from existing lease records")
        // But for a new lease, we might need to find the tenant ID from the active lease we found earlier,
        // or the user might be manually typing if no active lease.
        // The requirement says: "If an active lease exists: Automatically populate Tenant Name field. Tenant Name field must be read-only."
        // This implies if no active lease, they can't create a "Full Unit Lease" for a new tenant easily here? 
        // Actually, requirement 3 says: "Lease creation must store: unitId, tenantId"

        // Let's first try to find an active tenant for this unit to get the ID.
        const activeLeaseFound = await prisma.lease.findFirst({
            where: { unitId: uId, status: 'Active' }
        });

        let tenantId;
        if (activeLeaseFound) {
            tenantId = activeLeaseFound.tenantId;
        } else {
            // Fallback: try to find user by name if no active lease
            const user = await prisma.user.findFirst({
                where: { name: tenantName, role: 'TENANT' }
            });
            if (!user) return res.status(404).json({ message: 'Tenant not found' });
            tenantId = user.id;
        }

        // 3. LEASE ID CONSISTENCY: Reuse DRAFT lease if exists
        const draftLease = await prisma.lease.findFirst({
            where: { unitId: uId, tenantId: tenantId, status: 'DRAFT' }
        });

        let lease;
        const leaseData = {
            startDate: new Date(startDate),
            endDate: new Date(endDate),
            monthlyRent: parseFloat(monthlyRent) || 0,
            securityDeposit: parseFloat(securityDeposit) || 0,
            status: 'Active'
        };

        if (draftLease) {
            lease = await prisma.lease.update({
                where: { id: draftLease.id },
                data: leaseData,
                include: { unit: true, tenant: true }
            });
        } else {
            lease = await prisma.lease.create({
                data: {
                    unitId: uId,
                    tenantId: tenantId,
                    ...leaseData
                },
                include: { unit: true, tenant: true }
            });
        }


        // Update unit status to Occupied
        await prisma.unit.update({
            where: { id: uId },
            data: { status: 'Occupied' }
        });

        // NEW: Auto-create Invoice for the first month if Lease is Active
        if (lease.status === 'Active') {
            // Check if invoice already exists for this month/lease to avoid duplicates if re-running
            const monthStr = new Date(startDate).toLocaleString('default', { month: 'long', year: 'numeric' });

            const existingInvoice = await prisma.invoice.findFirst({
                where: {
                    tenantId: tenantId,
                    unitId: uId,
                    month: monthStr
                }
            });

            if (!existingInvoice) {
                // Fix: Use findFirst to get the last invoice number to ensure uniqueness, or use timestamp if gaps are allowed.
                // Using timestamp component to guarantee uniqueness.
                const invoiceNo = `INV-${Date.now()}`;

                await prisma.invoice.create({
                    data: {
                        invoiceNo,
                        tenantId: tenantId,
                        unitId: uId,
                        month: monthStr,
                        rent: parseFloat(monthlyRent) || 0,
                        serviceFees: 0,
                        amount: parseFloat(monthlyRent) || 0,
                        status: 'Unpaid' // As requested: UNPAID
                    }
                });
            }
        }

        res.status(201).json(lease);
    } catch (error) {
        console.error('Create Lease Error:', error);
        res.status(500).json({ message: 'Error creating lease' });
    }
};

// GET /api/admin/leases/units-with-tenants
exports.getUnitsWithTenants = async (req, res) => {
    try {
        const { propertyId, rentalMode } = req.query;

        if (!propertyId || !rentalMode) {
            return res.status(400).json({ message: 'propertyId and rentalMode are required' });
        }

        // Find units with assigned tenants (units that have DRAFT or Active leases)
        const units = await prisma.unit.findMany({
            where: {
                propertyId: parseInt(propertyId),
                rentalMode: rentalMode,
                leases: {
                    some: {
                        status: { in: ['DRAFT', 'Active'] }
                    }
                }
            },
            include: {
                leases: {
                    where: {
                        status: { in: ['DRAFT', 'Active'] }
                    },
                    include: {
                        tenant: true
                    },
                    take: 1
                }
            }
        });

        // Format response to match expected structure
        const formatted = units.map(u => {
            const activeLease = u.leases[0];
            return {
                id: u.id,
                unitNumber: u.name,
                tenantId: activeLease?.tenantId,
                tenantName: activeLease?.tenant?.name
            };
        });

        res.json({ data: formatted });
    } catch (error) {
        console.error('Get Units With Tenants Error:', error);
        res.status(500).json({ message: 'Server error' });
    }
};

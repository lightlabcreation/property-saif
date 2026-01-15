const prisma = require('../../config/prisma');
const { generateLeasePDF } = require('../../utils/pdf.utils');

// GET /api/admin/leases/:id/download
exports.downloadLeasePDF = async (req, res) => {
    try {
        const lease = await prisma.lease.findUnique({
            where: { id: parseInt(req.params.id) },
            include: {
                tenant: true,
                unit: {
                    include: { property: true }
                }
            }
        });

        if (!lease) return res.status(404).json({ message: 'Lease not found' });

        generateLeasePDF(lease, res);
    } catch (e) {
        console.error(e);
        res.status(500).json({ message: 'Error generating PDF' });
    }
};

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
        const id = parseInt(req.params.id);
        const lease = await prisma.lease.findUnique({ where: { id } });

        if (!lease) return res.status(404).json({ message: 'Lease not found' });

        if (lease.status === 'Active') {
            // Revert to DRAFT so it shows up in "New Lease" dropdown again
            await prisma.lease.update({
                where: { id },
                data: {
                    status: 'DRAFT',
                    startDate: null,
                    endDate: null,
                    monthlyRent: null,
                    securityDeposit: null
                }
            });

            // Update unit status back to Vacant
            await prisma.unit.update({
                where: { id: lease.unitId },
                data: { status: 'Vacant' }
            });

            res.json({ message: 'Lease reverted to DRAFT' });
        } else {
            // If it's already DRAFT or other, delete permanently
            await prisma.lease.delete({ where: { id } });
            res.json({ message: 'Deleted permanent' });
        }
    } catch (e) {
        console.error('Delete Lease Error:', e);
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
        const { unitId, tenantId, startDate, endDate, monthlyRent, securityDeposit } = req.body;

        if (!unitId || !tenantId) {
            return res.status(400).json({ message: 'Unit ID and Tenant ID are required' });
        }

        const uId = parseInt(unitId);
        const tId = parseInt(tenantId);

        const result = await prisma.$transaction(async (tx) => {
            // 1. Check for existing DRAFT or Active lease
            const draftLease = await tx.lease.findFirst({
                where: { unitId: uId, tenantId: tId, status: 'DRAFT' }
            });

            const leaseData = {
                startDate: new Date(startDate),
                endDate: new Date(endDate),
                monthlyRent: parseFloat(monthlyRent) || 0,
                securityDeposit: parseFloat(securityDeposit) || 0,
                status: 'Active'
            };

            let lease;
            if (draftLease) {
                lease = await tx.lease.update({
                    where: { id: draftLease.id },
                    data: leaseData,
                    include: { unit: true, tenant: true }
                });
            } else {
                lease = await tx.lease.create({
                    data: {
                        unitId: uId,
                        tenantId: tId,
                        ...leaseData
                    },
                    include: { unit: true, tenant: true }
                });
            }

            // 2. Update unit status to Occupied
            await tx.unit.update({
                where: { id: uId },
                data: { status: 'Occupied' }
            });

            // 3. Auto-create Invoice for the first month
            const monthStr = new Date(startDate).toLocaleString('default', { month: 'long', year: 'numeric' });
            const existingInvoice = await tx.invoice.findFirst({
                where: {
                    tenantId: tId,
                    unitId: uId,
                    month: monthStr
                }
            });

            if (!existingInvoice) {
                const count = await tx.invoice.count();
                const invoiceNo = `INV-LEASE-${String(count + 1).padStart(5, '0')}`;
                const rentAmt = parseFloat(monthlyRent) || 0;

                await tx.invoice.create({
                    data: {
                        invoiceNo,
                        tenantId: tId,
                        unitId: uId,
                        month: monthStr,
                        rent: rentAmt,
                        serviceFees: 0,
                        amount: rentAmt,
                        paidAmount: 0,
                        balanceDue: rentAmt,
                        status: 'sent',
                        dueDate: new Date(startDate) // Due on start date usually
                    }
                });
            }

            // 4. Record Security Deposit as a Liability Transaction (Requirement 3)
            if (parseFloat(securityDeposit) > 0) {
                const lastTx = await tx.transaction.findFirst({ orderBy: { id: 'desc' } });
                const prevBalance = lastTx ? parseFloat(lastTx.balance) : 0;

                await tx.transaction.create({
                    data: {
                        date: new Date(),
                        description: `Security Deposit Received - Lease ${lease.id}`,
                        type: 'Liability', // Treat as liability
                        amount: parseFloat(securityDeposit),
                        balance: prevBalance + parseFloat(securityDeposit),
                        status: 'Completed'
                    }
                });
            }

            return lease;
        });

        res.status(201).json(result);
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

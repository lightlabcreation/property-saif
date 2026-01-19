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
        const lease = await prisma.lease.findUnique({
            where: { id },
            include: {
                unit: {
                    include: { bedroomsList: true }
                },
                tenant: true
            }
        });

        if (!lease) return res.status(404).json({ message: 'Lease not found' });

        if (lease.status === 'Active') {
            await prisma.$transaction(async (tx) => {
                // Determine if this was a bedroom lease or full unit lease
                const tenantBedroomId = lease.tenant.bedroomId;
                const isBedroomLease = tenantBedroomId !== null;
                const isFullUnitLease = !isBedroomLease;

                if (isFullUnitLease) {
                    // Full Unit Lease: Reset all bedrooms to Vacant
                    if (lease.unit.bedroomsList.length > 0) {
                        await tx.bedroom.updateMany({
                            where: { unitId: lease.unitId },
                            data: { status: 'Vacant' }
                        });
                    }

                    // Reset unit status to Vacant
                    await tx.unit.update({
                        where: { id: lease.unitId },
                        data: { status: 'Vacant' }
                    });
                } else {
                    // Bedroom Lease: Reset only the specific bedroom
                    await tx.bedroom.update({
                        where: { id: tenantBedroomId },
                        data: { status: 'Vacant' }
                    });

                    // Check if all bedrooms are now vacant
                    const updatedUnit = await tx.unit.findUnique({
                        where: { id: lease.unitId },
                        include: { bedroomsList: true }
                    });

                    const allVacant = updatedUnit.bedroomsList.every(b => b.status === 'Vacant');
                    const anyOccupied = updatedUnit.bedroomsList.some(b => b.status === 'Occupied');

                    if (allVacant) {
                        // All bedrooms vacant, mark unit as Vacant
                        await tx.unit.update({
                            where: { id: lease.unitId },
                            data: { status: 'Vacant' }
                        });
                    } else if (anyOccupied) {
                        // Some bedrooms still occupied, keep as Occupied
                        await tx.unit.update({
                            where: { id: lease.unitId },
                            data: { status: 'Occupied' }
                        });
                    }
                }

                // Reset tenant's assignments
                await tx.user.update({
                    where: { id: lease.tenantId },
                    data: { bedroomId: null, unitId: null, buildingId: null }
                });

                // Actually delete the lease record
                await tx.lease.delete({
                    where: { id }
                });
            });

            res.json({ message: 'Lease deleted and statuses reset' });
        } else {
            // If it's already DRAFT or other, delete permanently AND unlink tenant
            await prisma.$transaction(async (tx) => {
                // Reset tenant's assignments
                await tx.user.update({
                    where: { id: lease.tenantId },
                    data: { bedroomId: null, unitId: null, buildingId: null }
                });

                await tx.lease.delete({ where: { id } });
            });
            res.json({ message: 'Deleted permanently' });
        }
    } catch (e) {
        console.error('Delete Lease Error:', e);
        res.status(500).json({ message: 'Error deleting lease' });
    }
};

// PUT /api/admin/leases/:id (Basic update)
exports.updateLease = async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const { monthlyRent } = req.body;

        if (monthlyRent === undefined) {
            return res.status(400).json({ message: 'monthlyRent is required' });
        }

        const rentAmt = parseFloat(monthlyRent);
        if (isNaN(rentAmt) || rentAmt < 0) {
            return res.status(400).json({ message: 'Invalid rent amount' });
        }

        const result = await prisma.$transaction(async (tx) => {
            // 1. Update lease
            const updatedLease = await tx.lease.update({
                where: { id },
                data: { monthlyRent: rentAmt },
                include: { unit: true }
            });

            // 2. Sync with existing UNPAID invoices for this lease that have $0 amount
            // This handles cases where invoices were generated as $0 before rent was set.
            await tx.invoice.updateMany({
                where: {
                    leaseId: id,
                    status: { not: 'paid' },
                    amount: 0
                },
                data: {
                    rent: rentAmt,
                    amount: rentAmt,
                    balanceDue: rentAmt
                }
            });

            return updatedLease;
        });

        res.json(result);
    } catch (e) {
        console.error('Update Lease Error:', e);
        res.status(500).json({ message: 'Error updating lease rent' });
    }
};

// POST /api/admin/leases/:id/activate
exports.activateLease = async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const lease = await prisma.lease.findUnique({
            where: { id },
            include: {
                unit: {
                    include: { bedroomsList: true }
                },
                tenant: true
            }
        });

        if (!lease) return res.status(404).json({ message: 'Lease not found' });

        const result = await prisma.$transaction(async (tx) => {
            const startDate = new Date();
            // 1. Update lease status and start date
            const updatedLease = await tx.lease.update({
                where: { id },
                data: {
                    status: 'Active',
                    startDate: startDate
                },
                include: { unit: true }
            });

            // 2. Resolve Lease Type and Update Statuses
            const tId = lease.tenantId;
            const uId = lease.unitId;
            const bId = lease.tenant.bedroomId;
            const isFullUnitLease = bId === null;
            const isBedroomLease = !isFullUnitLease;

            // VALIDATION BEFORE ACTIVATION
            if (isFullUnitLease) {
                // Check if any bedrooms are already occupied
                const occupiedBedrooms = lease.unit.bedroomsList.filter(b => b.status === 'Occupied');
                if (occupiedBedrooms.length > 0) {
                    throw new Error(`Cannot activate full unit lease: ${occupiedBedrooms.length} bedroom(s) are already occupied. Please ensure all bedrooms are vacant.`);
                }
            } else {
                // Check if unit is already leased as a full unit
                if (lease.unit.status === 'Fully Booked' && lease.unit.rentalMode === 'FULL_UNIT') {
                    throw new Error('Cannot activate bedroom lease: This unit is fully occupied as a full unit.');
                }
            }

            if (isFullUnitLease) {
                // Full Unit Lease: Mark unit as Fully Booked and all bedrooms as Occupied
                await tx.unit.update({
                    where: { id: uId },
                    data: {
                        status: 'Fully Booked',
                        rentalMode: 'FULL_UNIT'
                    }
                });

                if (lease.unit.bedroomsList.length > 0) {
                    await tx.bedroom.updateMany({
                        where: { unitId: uId },
                        data: { status: 'Occupied' }
                    });
                }
            } else {
                // Bedroom Lease: Mark specific bedroom as Occupied
                await tx.bedroom.update({
                    where: { id: bId },
                    data: { status: 'Occupied' }
                });

                // Update unit rental mode to BEDROOM_WISE
                await tx.unit.update({
                    where: { id: uId },
                    data: { rentalMode: 'BEDROOM_WISE' }
                });

                // Recalculate unit status
                const unitWithBedrooms = await tx.unit.findUnique({
                    where: { id: uId },
                    include: { bedroomsList: true }
                });

                const allOccupied = unitWithBedrooms.bedroomsList.every(b => b.status === 'Occupied');
                await tx.unit.update({
                    where: { id: uId },
                    data: { status: allOccupied ? 'Fully Booked' : 'Occupied' }
                });
            }

            // 3. Auto-create Invoice for the current month
            const monthStr = startDate.toLocaleString('default', { month: 'long', year: 'numeric' });
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
                const rentAmt = parseFloat(updatedLease.monthlyRent) || 0;

                await tx.invoice.create({
                    data: {
                        invoiceNo,
                        tenantId: tId,
                        unitId: uId,
                        leaseId: updatedLease.id,
                        leaseType: updatedLease.unit.rentalMode,
                        month: monthStr,
                        rent: rentAmt,
                        amount: rentAmt,
                        balanceDue: rentAmt,
                        status: 'sent',
                        dueDate: startDate
                    }
                });
            }

            return updatedLease;
        });

        res.json(result);
    } catch (error) {
        console.error('Activate Lease Error:', error);
        res.status(500).json({ message: 'Error activating lease' });
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
        const { unitId, bedroomId, tenantId, startDate, endDate, monthlyRent, securityDeposit } = req.body;

        if (!unitId || !tenantId) {
            return res.status(400).json({ message: 'Unit ID and Tenant ID are required' });
        }

        const uId = parseInt(unitId);
        const tId = parseInt(tenantId);
        const bId = bedroomId ? parseInt(bedroomId) : null;

        const result = await prisma.$transaction(async (tx) => {
            // Fetch unit with bedrooms and existing leases
            const unit = await tx.unit.findUnique({
                where: { id: uId },
                include: {
                    bedroomsList: true,
                    leases: {
                        where: { status: { in: ['Active', 'DRAFT'] } }
                    }
                }
            });

            if (!unit) {
                throw new Error('Unit not found');
            }

            // Determine lease type based on presence of bedroomId
            const isBedroomLease = bId !== null;
            const isFullUnitLease = !isBedroomLease;

            // VALIDATION FOR FULL UNIT LEASE
            if (isFullUnitLease) {
                // Check if any bedrooms are already occupied
                const occupiedBedrooms = unit.bedroomsList.filter(b => b.status === 'Occupied');
                if (occupiedBedrooms.length > 0) {
                    throw new Error(`Cannot create full unit lease: ${occupiedBedrooms.length} bedroom(s) are already occupied. Please ensure all bedrooms are vacant.`);
                }

                // Check for EXISTING Active lease for this unit
                const activeLease = unit.leases.find(l => l.status === 'Active');
                if (activeLease) {
                    throw new Error('Cannot create full unit lease: This unit already has an ACTIVE lease.');
                }

                // Check for DRAFT leases for DIFFERENT tenants
                const otherDraftLease = unit.leases.find(l => l.status === 'DRAFT' && l.tenantId !== tId);
                if (otherDraftLease) {
                    throw new Error('Cannot create full unit lease: This unit already has a pending lease for another tenant.');
                }
            }

            // VALIDATION FOR BEDROOM LEASE
            if (isBedroomLease) {
                // Check for EXISTING Active lease in FULL_UNIT mode
                const activeFullLease = unit.leases.find(l => l.status === 'Active' && (unit.rentalMode === 'FULL_UNIT' || !unit.rentalMode));
                if (activeFullLease) {
                    throw new Error('Cannot lease bedroom: This unit already has an ACTIVE full unit lease.');
                }

                // Check for DRAFT full unit leases for DIFFERENT tenants
                const otherDraftFullLease = unit.leases.find(l => l.status === 'DRAFT' && (unit.rentalMode === 'FULL_UNIT' || !unit.rentalMode) && l.tenantId !== tId);
                if (otherDraftFullLease) {
                    throw new Error('Cannot lease bedroom: This unit is already reserved as a full unit for another tenant.');
                }

                // Find the specific bedroom
                const bedroom = unit.bedroomsList.find(b => b.id === bId);
                if (!bedroom) {
                    throw new Error('Bedroom not found in this unit');
                }

                // Check if bedroom is available
                if (bedroom.status !== 'Vacant') {
                    throw new Error(`Bedroom ${bedroom.bedroomNumber} is not available (current status: ${bedroom.status})`);
                }
            }

            // Check for existing DRAFT lease
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

            // UPDATE STATUSES BASED ON LEASE TYPE
            if (isFullUnitLease) {
                // Full Unit Lease: Mark unit as Fully Booked and all bedrooms as Occupied
                await tx.unit.update({
                    where: { id: uId },
                    data: {
                        status: 'Fully Booked',
                        rentalMode: 'FULL_UNIT'
                    }
                });

                // Mark all bedrooms as Occupied
                if (unit.bedroomsList.length > 0) {
                    await tx.bedroom.updateMany({
                        where: { unitId: uId },
                        data: { status: 'Occupied' }
                    });
                }

                // Update tenant's bedroomId to null (full unit, not specific bedroom)
                await tx.user.update({
                    where: { id: tId },
                    data: { bedroomId: null }
                });
            } else {
                // Bedroom Lease: Mark specific bedroom as Occupied
                await tx.bedroom.update({
                    where: { id: bId },
                    data: { status: 'Occupied' }
                });

                // Update unit rental mode to BEDROOM_WISE
                await tx.unit.update({
                    where: { id: uId },
                    data: { rentalMode: 'BEDROOM_WISE' }
                });

                // Check if all bedrooms are now occupied
                const updatedUnit = await tx.unit.findUnique({
                    where: { id: uId },
                    include: { bedroomsList: true }
                });
                const allOccupied = updatedUnit.bedroomsList.every(b => b.status === 'Occupied');

                if (allOccupied) {
                    // All bedrooms occupied, mark unit as Fully Booked
                    await tx.unit.update({
                        where: { id: uId },
                        data: { status: 'Fully Booked' }
                    });
                } else {
                    // Some bedrooms still vacant, mark as Occupied
                    await tx.unit.update({
                        where: { id: uId },
                        data: { status: 'Occupied' }
                    });
                }

                // Update tenant's bedroomId
                await tx.user.update({
                    where: { id: tId },
                    data: { bedroomId: bId }
                });
            }

            // Auto-create Invoice for the first month
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
                        leaseId: lease.id,
                        leaseType: isFullUnitLease ? 'FULL_UNIT' : 'BEDROOM_WISE',
                        month: monthStr,
                        rent: rentAmt,
                        serviceFees: 0,
                        amount: rentAmt,
                        paidAmount: 0,
                        balanceDue: rentAmt,
                        status: 'sent',
                        dueDate: new Date(startDate)
                    }
                });
            }

            // Record Security Deposit as a Liability Transaction
            if (parseFloat(securityDeposit) > 0) {
                const lastTx = await tx.transaction.findFirst({ orderBy: { id: 'desc' } });
                const prevBalance = lastTx ? parseFloat(lastTx.balance) : 0;

                await tx.transaction.create({
                    data: {
                        date: new Date(),
                        description: `Security Deposit Received - Lease ${lease.id}${isBedroomLease ? ' (Bedroom)' : ' (Full Unit)'}`,
                        type: 'Liability',
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
        // Return user-friendly error messages
        const message = error.message || 'Error creating lease';
        res.status(400).json({ message });
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

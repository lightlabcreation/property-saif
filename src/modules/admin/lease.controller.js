const prisma = require('../../config/prisma');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const smsService = require('../../services/sms.service');
const emailService = require('../../services/email.service');
const { generateLeasePDF } = require('../../utils/pdf.utils');
const AppError = require('../../utils/AppError');
const catchAsync = require('../../utils/catchAsync');

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
            include: {
                tenant: true,
                residents: true, // Include co-tenants
                unit: {
                    include: { property: true }
                },
                bedroom: true
            },
            orderBy: { createdAt: 'desc' }
        });

        // Collect all unique tenant emails to check communication logs efficiently
        const tenantEmails = [...new Set(leases.map(l => l.tenant.email).filter(Boolean))];

        // Fetch logs for these tenants
        const sentLogs = await prisma.communicationLog.findMany({
            where: {
                recipient: { in: tenantEmails },
                eventType: 'TENANT_CREATION_CREDENTIALS',
                status: 'Sent'
            },
            select: { recipient: true }
        });

        const sentEmailSet = new Set(sentLogs.map(log => log.recipient));

        const formatted = leases.map(l => {
            const primaryName = l.tenant.name || `${l.tenant.firstName || ''} ${l.tenant.lastName || ''}`.trim();
            const residentNames = l.residents.map(r => r.name || `${r.firstName || ''} ${r.lastName || ''}`.trim());
            const allTenants = [primaryName, ...residentNames].filter(Boolean).join(', ');

            // Check if credentials were sent to this tenant's email
            // Use l.tenant.email directly. If no email, they can't have received them.
            const isCredentialsSent = l.tenant.email && sentEmailSet.has(l.tenant.email);

            return {
                id: l.id,
                leaseType: l.leaseType === 'FULL_UNIT' ? 'Full Unit Lease' : 'Bedroom Lease',
                buildingName: l.unit.property.civicNumber
                    ? `${l.unit.property.name} - ${l.unit.property.civicNumber}`
                    : l.unit.property.name,
                unit: l.unit.unitNumber || l.unit.name,
                bedroom: l.bedroom ? l.bedroom.bedroomNumber : '-',
                tenant: allTenants, // Show all occupants
                primaryTenantName: primaryName,
                coTenants: residentNames,
                tenantFirstName: l.tenant.firstName,
                tenantLastName: l.tenant.lastName,
                term: l.startDate && l.endDate
                    ? `${l.startDate.toISOString().substring(0, 10)} to ${l.endDate.toISOString().substring(0, 10)}`
                    : 'Dates Pending',
                status: l.status,
                startDate: l.startDate ? l.startDate.toISOString().substring(0, 10) : '',
                endDate: l.endDate ? l.endDate.toISOString().substring(0, 10) : '',
                monthlyRent: l.monthlyRent || 0,
                isCredentialsSent: isCredentialsSent,
                tenantId: l.tenantId
            };
        });

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

                // Reset residents associated with this lease
                await tx.user.updateMany({
                    where: { leaseId: id, type: 'RESIDENT' },
                    data: { leaseId: null }
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

// PUT /api/admin/leases/:id
exports.updateLease = catchAsync(async (req, res, next) => {
    const id = parseInt(req.params.id);
    const { monthlyRent, startDate, endDate, firstName, lastName } = req.body;

    const result = await prisma.$transaction(async (tx) => {
        // 0. Fetch existing lease to get tenantId
        const existingLease = await tx.lease.findUnique({
            where: { id },
            include: { tenant: true }
        });

        if (!existingLease) throw new AppError('Lease not found', 404);

        // 1. Update Tenant Name if provided
        if (firstName !== undefined || lastName !== undefined) {
            await tx.user.update({
                where: { id: existingLease.tenantId },
                data: {
                    firstName: firstName !== undefined ? firstName : existingLease.tenant.firstName,
                    lastName: lastName !== undefined ? lastName : existingLease.tenant.lastName,
                    name: `${firstName !== undefined ? firstName : existingLease.tenant.firstName} ${lastName !== undefined ? lastName : existingLease.tenant.lastName}`.trim()
                }
            });
        }

        // 2. Prepare lease update data
        const leaseUpdateData = {};
        if (monthlyRent !== undefined) {
            const rentAmt = parseFloat(monthlyRent);
            if (isNaN(rentAmt) || rentAmt < 0) throw new AppError('Invalid rent amount', 400);
            leaseUpdateData.monthlyRent = rentAmt;
        }
        if (startDate) leaseUpdateData.startDate = new Date(startDate);
        if (endDate) leaseUpdateData.endDate = new Date(endDate);

        // 3. Update lease
        const updatedLease = await tx.lease.update({
            where: { id },
            data: leaseUpdateData,
            include: { unit: true, tenant: true }
        });

        // 4. Sync with existing UNPAID invoices for this lease if rent changed
        if (leaseUpdateData.monthlyRent !== undefined) {
            await tx.invoice.updateMany({
                where: {
                    leaseId: id,
                    status: { not: 'paid' },
                    amount: 0
                },
                data: {
                    rent: leaseUpdateData.monthlyRent.toString(),
                    amount: leaseUpdateData.monthlyRent.toString(),
                    balanceDue: leaseUpdateData.monthlyRent.toString()
                }
            });
        }

        return updatedLease;
    });

    res.json({ success: true, data: result });
});

// POST /api/admin/leases/:id/activate
exports.activateLease = catchAsync(async (req, res, next) => {
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

    if (!lease) throw new AppError('Lease not found', 404);

    const result = await prisma.$transaction(async (tx) => {
        const startDate = new Date();

        // 2. Resolve Lease Type and Update Statuses
        const tId = lease.tenantId;
        const uId = lease.unitId;
        const bId = lease.tenant.bedroomId;
        const isFullUnitLease = bId === null;

        // VALIDATION BEFORE ACTIVATION
        if (isFullUnitLease) {
            // Check if any bedrooms are already occupied
            const occupiedBedrooms = lease.unit.bedroomsList.filter(b => b.status === 'Occupied');
            if (occupiedBedrooms.length > 0) {
                throw new AppError(`Cannot activate full unit lease: ${occupiedBedrooms.length} bedroom(s) are already occupied. Please ensure all bedrooms are vacant.`, 400);
            }
        } else {
            // Check if unit is already leased as a full unit
            if (lease.unit.status === 'Fully Booked' && lease.unit.rentalMode === 'FULL_UNIT') {
                throw new AppError('Cannot activate bedroom lease: This unit is fully occupied as a full unit.', 400);
            }
        }

        // 1. Update lease status and start date
        const updatedLease = await tx.lease.update({
            where: { id },
            data: {
                status: 'Active',
                startDate: startDate,
                leaseType: lease.tenant.bedroomId ? 'BEDROOM' : 'FULL_UNIT',
                bedroomId: lease.tenant.bedroomId
            },
            include: { unit: true }
        });

        // Sync tenant's residents to this lease
        await tx.user.updateMany({
            where: { parentId: tId, type: 'RESIDENT' },
            data: { leaseId: id }
        });

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

    // 5. Automatic Invite for Activation
    const notificationResult = await processOnboardingInvitations(lease.tenantId);

    res.json({
        success: true,
        data: result,
        notifications: notificationResult
    });
});

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
exports.createLease = catchAsync(async (req, res, next) => {
    const { unitId, bedroomId, tenantId, startDate, endDate, monthlyRent, securityDeposit, coTenantIds } = req.body;

    if (!unitId || !tenantId) {
        throw new AppError('Unit ID and Tenant ID are required', 400);
    }

    const uId = parseInt(unitId);
    const tId = parseInt(tenantId);
    const bId = bedroomId ? parseInt(bedroomId) : null;

    const result = await prisma.$transaction(async (tx) => {
        // Check Tenant Type - Residents cannot have direct leases
        const targetTenant = await tx.user.findUnique({
            where: { id: tId }
        });

        if (!targetTenant) {
            throw new AppError('Tenant not found', 404);
        }

        if (targetTenant.type === 'RESIDENT') {
            throw new AppError('Residents (Occupants) cannot hold direct leases. Please assign them as occupants in the Tenant module instead.', 400);
        }

        // Fetch unit with bedrooms and existing leases
        const unit = await tx.unit.findUnique({
            where: { id: uId },
            include: {
                bedroomsList: true,
                leases: {
                    where: { status: { in: ['Active', 'DRAFT'] } },
                    include: { tenant: { select: { type: true } } }
                }
            }
        });

        if (!unit) {
            throw new AppError('Unit not found', 404);
        }

        // Determine lease type based on presence of bedroomId
        const isBedroomLease = bId !== null;
        const isFullUnitLease = !isBedroomLease;

        // VALIDATION FOR FULL UNIT LEASE
        if (isFullUnitLease) {
            // Check if any bedrooms are already occupied
            const occupiedBedrooms = unit.bedroomsList.filter(b => b.status === 'Occupied');
            if (occupiedBedrooms.length > 0) {
                throw new AppError(`Cannot create full unit lease: ${occupiedBedrooms.length} bedroom(s) are already occupied. Please ensure all bedrooms are vacant.`, 400);
            }

            // Check for EXISTING Active lease for this unit
            const activeLease = unit.leases.find(l => l.status === 'Active');
            if (activeLease) {
                throw new AppError('Cannot create full unit lease: This unit already has an ACTIVE lease.', 400);
            }

            // Check for DRAFT leases for DIFFERENT tenants
            const otherDraftLease = unit.leases.find(l => l.status === 'DRAFT' && l.tenantId !== tId);
            if (otherDraftLease) {
                throw new AppError('Cannot create full unit lease: This unit already has a pending lease for another tenant.', 400);
            }
        }

        // VALIDATION FOR BEDROOM LEASE
        if (isBedroomLease) {
            // Check for EXISTING Active lease in FULL_UNIT mode (blocking only if NOT a company lease)
            const activeFullLease = unit.leases.find(l =>
                l.status === 'Active' &&
                l.leaseType === 'FULL_UNIT' &&
                l.tenant.type !== 'COMPANY'
            );
            if (activeFullLease) {
                throw new AppError('Cannot lease bedroom: This unit already has an ACTIVE individual full unit lease.', 400);
            }

            // Check for DRAFT full unit leases for DIFFERENT tenants
            const otherDraftFullLease = unit.leases.find(l =>
                l.status === 'DRAFT' &&
                l.leaseType === 'FULL_UNIT' &&
                l.tenantId !== tId
            );
            if (otherDraftFullLease) {
                throw new AppError('Cannot lease bedroom: This unit is already reserved as a full unit for another tenant.', 400);
            }

            // Find the specific bedroom
            const bedroom = unit.bedroomsList.find(b => b.id === bId);
            if (!bedroom) {
                throw new AppError('Bedroom not found in this unit', 404);
            }

            // Check if bedroom is available
            const hasCompanyLease = unit.leases.some(l => l.status === 'Active' && l.tenant.type === 'COMPANY');
            const hasExistingResidentLease = unit.leases.some(l => l.status === 'Active' && l.bedroomId === bId && l.tenant.type === 'RESIDENT');

            if (bedroom.status !== 'Vacant') {
                // Special case: Allow if it's "Occupied" by a Company Lease but has no resident assigned yet
                if (hasCompanyLease && !hasExistingResidentLease) {
                    // This is fine, we are assigning the resident to a bedroom reserved by the company
                } else {
                    throw new AppError(`Bedroom ${bedroom.bedroomNumber} is not available (current status: ${bedroom.status})`, 400);
                }
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
            status: 'Active',
            leaseType: isBedroomLease ? 'BEDROOM' : 'FULL_UNIT',
            bedroomId: bId
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
            // Full Unit Lease: Mark unit as Fully Booked (if Individual) or Occupied (if Company)
            const isCompanyLease = targetTenant.type === 'COMPANY';
            await tx.unit.update({
                where: { id: uId },
                data: {
                    status: isCompanyLease ? 'Occupied' : 'Fully Booked',
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

            // Update unit rental mode to BEDROOM_WISE (if not already set by a company lease)
            if (unit.rentalMode !== 'FULL_UNIT') {
                await tx.unit.update({
                    where: { id: uId },
                    data: { rentalMode: 'BEDROOM_WISE' }
                });
            }

            // Check if all bedrooms are now occupied BY INDIVIDUAL RESIDENT LEASES if it's a company-leased unit
            const updatedUnit = await tx.unit.findUnique({
                where: { id: uId },
                include: {
                    bedroomsList: true,
                    leases: {
                        where: { status: 'Active', leaseType: 'BEDROOM' }
                    }
                }
            });

            const hasCompanyLease = unit.leases.some(l => l.status === 'Active' && l.tenant.type === 'COMPANY');
            const allOccupied = updatedUnit.bedroomsList.every(b => b.status === 'Occupied');

            if (allOccupied) {
                if (hasCompanyLease) {
                    // If it's a company unit, only mark Fully Booked if all bedrooms have specific resident leases
                    const residentLeaseCount = updatedUnit.leases.length;
                    if (residentLeaseCount === updatedUnit.bedroomsList.length) {
                        await tx.unit.update({
                            where: { id: uId },
                            data: { status: 'Fully Booked' }
                        });
                    } else {
                        // Still some rooms without individual residents assigned
                        await tx.unit.update({
                            where: { id: uId },
                            data: { status: 'Occupied' }
                        });
                    }
                } else {
                    // Individual bedroom-wise leasing: all rooms occupied = Fully Booked
                    await tx.unit.update({
                        where: { id: uId },
                        data: { status: 'Fully Booked' }
                    });
                }
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

        // Determine who to bill: If tenant is a RESIDENT, bill their Parent
        const billableTenantId = targetTenant.type === 'RESIDENT' ? targetTenant.parentId : tId;

        const existingInvoice = await tx.invoice.findFirst({
            where: {
                tenantId: billableTenantId,
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
                    tenantId: billableTenantId,
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

        // 4. Link Co-Tenants (Residents)
        if (coTenantIds && Array.isArray(coTenantIds) && coTenantIds.length > 0) {
            // Verify no co-tenant is the primary tenant
            if (coTenantIds.includes(tId)) {
                throw new AppError('Primary tenant cannot be a co-tenant.', 400);
            }

            // Update co-tenants to link to this lease
            // We typically assume co-tenants are "Residents" or "Occupants" for this lease
            // NOTE: This logic assumes co-tenants are existing Users.
            await tx.user.updateMany({
                where: { id: { in: coTenantIds.map(id => parseInt(id)) } },
                data: {
                    leaseId: lease.id,
                    // Optionally update their address to match the unit
                    unitId: uId,
                    buildingId: unit.propertyId,
                    ...(bId ? { bedroomId: bId } : {})
                }
            });
        }
        return { lease };
    });

    // 5. Automatic Onboarding Invitations
    // Check if sendCredentials flag is true (default to true if undefined for backward compatibility, 
    // but the frontend will send it explicitly)
    const sendCredentials = req.body.sendCredentials !== false;

    let notificationResult = { status: 'Skipped', message: 'Credentials not sent by user request.' };

    if (sendCredentials) {
        notificationResult = await processOnboardingInvitations(tId, coTenantIds);
    }

    res.status(201).json({
        success: true,
        data: result.lease,
        notifications: notificationResult
    });
});

// Helper function to handle automatic onboarding invitations for primary and co-tenants
const processOnboardingInvitations = async (tenantId, coTenantIds = [], methods = ['email', 'sms']) => {
    try {
        const tenantIds = [tenantId, ...coTenantIds].filter(Boolean);
        if (tenantIds.length === 0) return { status: 'Skipped', message: 'No tenants to invite' };

        const users = await prisma.user.findMany({
            where: {
                id: { in: tenantIds.map(id => parseInt(id)) },
                type: { not: 'RESIDENT' } // SKIP RESIDENTS
            }
        });

        const results = {
            total: users.length,
            sent: 0,
            failed: 0,
            details: []
        };

        const loginUrl = process.env.FRONTEND_URL || 'https://property-n.kiaantechnology.com';

        for (const user of users) {
            let password = null;
            let hashedPassword = undefined;

            // Generate password if user has none
            if (!user.password) {
                password = Math.floor(100000 + Math.random() * 900000).toString();
                hashedPassword = await bcrypt.hash(password, 10);
            }

            const inviteToken = crypto.randomBytes(32).toString('hex');
            const inviteExpires = new Date();
            inviteExpires.setDate(inviteExpires.getDate() + 7);

            // Update user with credentials/token
            const updatedUser = await prisma.user.update({
                where: { id: user.id },
                data: {
                    ...(hashedPassword ? { password: hashedPassword } : {}),
                    inviteToken,
                    inviteExpires
                }
            });

            const inviteLink = `${loginUrl}/tenant/invite/${inviteToken}`;
            let welcomeMsg = `Welcome to Property Management! \n\nYour login credentials for the portal: \nEmail: ${updatedUser.email}`;
            if (password) {
                welcomeMsg += ` \nPassword: ${password}`;
            }
            welcomeMsg += ` \n\nAccess your portal here: ${inviteLink}`;

            const sendResults = { email: false, sms: false };

            if (methods.includes('email') && updatedUser.email) {
                const eRes = await emailService.sendEmail(updatedUser.email, 'Welcome - Your Portal Access', welcomeMsg, { recipientId: user.id });
                sendResults.email = eRes.success;
            }

            if (methods.includes('sms') && updatedUser.phone) {
                const sRes = await smsService.sendSMS(updatedUser.phone, welcomeMsg);
                sendResults.sms = sRes.success;
            }

            if (sendResults.email || sendResults.sms) {
                results.sent++;
            } else {
                results.failed++;
            }

            results.details.push({
                userId: user.id,
                email: updatedUser.email,
                sentSms: sendResults.sms,
                sentEmail: sendResults.email
            });
        }

        return {
            status: results.sent > 0 ? 'Sent' : 'Failed',
            sms: results.details.some(d => d.sentSms),
            email: results.details.some(d => d.sentEmail),
            results
        };
    } catch (error) {
        console.error('Onboarding Invitations Error:', error);
        return { status: 'Failed', message: error.message };
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
                        status: 'Active'
                    }
                }
            },
            include: {
                leases: {
                    where: {
                        status: 'Active'
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

// POST /api/admin/leases/:id/send-credentials
exports.sendCredentials = async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const lease = await prisma.lease.findUnique({
            where: { id },
            include: { tenant: true }
        });

        if (!lease) return res.status(404).json({ message: 'Lease not found' });

        const result = await processOnboardingInvitations(lease.tenantId);

        res.json({
            success: true,
            message: result.status === 'Sent' ? 'Credentials sent successfully' : 'Failed to send credentials',
            details: result
        });
    } catch (e) {
        console.error('Send Credentials Error:', e);
        res.status(500).json({ message: 'Error sending credentials' });
    }
};

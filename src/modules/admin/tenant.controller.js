const bcrypt = require('bcrypt');
const crypto = require('crypto');
const prisma = require('../../config/prisma');
const smsService = require('../../services/sms.service');
const emailService = require('../../services/email.service');
const AppError = require('../../utils/AppError');
const catchAsync = require('../../utils/catchAsync');

// GET /api/admin/tenants
exports.getAllTenants = async (req, res) => {
    try {
        const { propertyId } = req.query;
        const whereClause = { role: 'TENANT' }; // Show all tenants including residents as requested

        if (propertyId) {
            whereClause.leases = {
                some: {
                    status: { in: ['Active', 'DRAFT'] },
                    unit: { propertyId: parseInt(propertyId) }
                }
            };
        }

        const tenants = await prisma.user.findMany({
            where: whereClause,
            include: {
                leases: {
                    where: { status: { in: ['Active', 'DRAFT'] } },
                    include: {
                        unit: {
                            include: {
                                property: true
                            }
                        }
                    }
                },
                insurances: true,
                documents: true,
                residents: {
                    include: {
                        residentLease: {
                            include: { unit: true }
                        },
                        leases: {
                            where: { status: { in: ['Active', 'DRAFT'] } },
                            include: { unit: true }
                        }
                    }
                },
                parent: {
                    include: {
                        leases: {
                            where: { status: { in: ['Active', 'DRAFT'] } }
                        }
                    }
                },
                companyContacts: true,
                residentLease: {
                    include: {
                        unit: {
                            include: {
                                property: true
                            }
                        }
                    }
                }
            }
        });

        const sortedTenants = [...tenants].sort((a, b) => b.id - a.id);

        // Fetch all units and properties into a map for fast lookup of resident assignments
        const units = await prisma.unit.findMany({ include: { property: true } });
        const unitMap = new Map(units.map(u => [u.id, u]));

        const formatted = sortedTenants.map(t => {
            // Find active lease first
            let activeLease = t.leases.find(l => l.status === 'Active') ||
                (t.residentLease?.status === 'Active' ? t.residentLease : null) ||
                t.leases.find(l => l.status === 'DRAFT') ||
                (t.residentLease?.status === 'DRAFT' ? t.residentLease : null);

            // If no lease, check if they are a resident assigned to a unit
            let propName = activeLease?.unit?.property?.name || 'No Property';
            let uName = activeLease?.unit?.name || 'No Unit';
            let lStatus = activeLease ? activeLease.status : 'Inactive';

            if (t.type === 'RESIDENT' && t.unitId) {
                const assignedUnit = unitMap.get(t.unitId);
                if (assignedUnit) {
                    propName = assignedUnit.property?.name || 'No Property';
                    uName = assignedUnit.unitNumber || assignedUnit.name || 'No Unit';

                    // Validate: Resident is Active ONLY if the Parent has an active lease for this specific unit
                    const parentHasLease = t.parent?.leases?.some(l => l.unitId === t.unitId && l.status === 'Active');
                    lStatus = parentHasLease ? 'Active' : 'Inactive';
                }
            }

            // Inherit from residents if parent has no active lease (UI helper)
            if (!activeLease && t.residents?.length > 0) {
                const residentWithLease = t.residents.find(r => r.residentLease?.status === 'Active' || r.leases?.some(l => l.status === 'Active'));
                if (residentWithLease) lStatus = 'Active';
            }

            let displayName = t.name || `${t.firstName || ''} ${t.lastName || ''}`.trim();
            if (t.type === 'COMPANY' && t.companyName) displayName = t.companyName;

            return {
                id: t.id,
                name: displayName,
                firstName: t.firstName,
                lastName: t.lastName,
                type: t.type || 'Individual',
                companyName: t.companyName,
                email: t.email,
                phone: t.phone,
                propertyId: activeLease?.unit?.propertyId || t.buildingId || null,
                unitId: activeLease?.unitId || t.unitId || null,
                bedroomId: activeLease?.bedroomId || t.bedroomId || null,
                property: propName,
                unit: uName,
                leaseStatus: lStatus,
                activeLeaseRole: activeLease ? (t.leases.find(l => l.id === activeLease.id) ? 'TENANT' : 'RESIDENT') : null,
                rentAmount: activeLease?.monthlyRent || 0,
                insurance: t.insurances,
                documents: t.documents,
                parentId: t.parentId,
                parentName: t.parent ? t.parent.name || `${t.parent.firstName || ''} ${t.parent.lastName || ''}`.trim() : null,
                hasPortalAccess: !!t.password
            };
        });

        res.json(formatted);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
};

// GET /api/admin/tenants/:id
exports.getTenantById = async (req, res) => {
    try {
        const { id } = req.params;
        const tenantId = parseInt(id);

        let tenant = await prisma.user.findUnique({
            where: { id: tenantId },
            include: {
                leases: {
                    include: { unit: { include: { property: true } } }
                },
                insurances: true,
                documents: true, // Direct ownership documents
                residents: true,
                residentLease: {
                    include: { unit: { include: { property: true } } }
                },
                parent: true
            }
        });

        if (!tenant) return res.status(404).json({ message: 'Tenant not found' });

        // If no lease, check for direct assignment (for Residents)
        if (tenant.unitId) {
            const directUnit = await prisma.unit.findUnique({
                where: { id: tenant.unitId },
                include: { property: true }
            });
            if (directUnit) {
                tenant.assignedUnit = directUnit;
            }
        }

        // Fetch documents linked via DocumentLink (entityType="USER", entityId=tenantId)
        const linkedDocuments = await prisma.document.findMany({
            where: {
                links: {
                    some: {
                        entityType: 'USER',
                        entityId: tenantId
                    }
                }
            },
            include: {
                links: true
            }
        });

        // Combine direct documents and linked documents, removing duplicates
        const allDocumentsMap = new Map();

        // Add direct ownership documents
        tenant.documents.forEach(doc => {
            allDocumentsMap.set(doc.id, doc);
        });

        // Add linked documents
        linkedDocuments.forEach(doc => {
            allDocumentsMap.set(doc.id, doc);
        });

        // Replace tenant.documents with combined list, formatting dates
        tenant.documents = Array.from(allDocumentsMap.values()).map(doc => ({
            ...doc,
            expiryDate: doc.expiryDate ? doc.expiryDate.toISOString().split('T')[0] : null,
            createdAt: doc.createdAt ? doc.createdAt.toISOString() : doc.createdAt,
            updatedAt: doc.updatedAt ? doc.updatedAt.toISOString() : doc.updatedAt
        }));

        res.json(tenant);
    } catch (error) {
        console.error('Get Tenant By ID Error:', error);
        res.status(500).json({ message: 'Server error' });
    }
};

// POST /api/admin/tenants
exports.createTenant = catchAsync(async (req, res, next) => {
    const {
        firstName, lastName, email, type, unitId, bedroomId, propertyId,
        companyName, companyDetails, residents, parentId,
        street, city, state, postalCode, country
    } = req.body;
    let { phone, password } = req.body;

    const errors = {};
    if (!firstName) errors.firstName = 'First name is required';
    if (!lastName) errors.lastName = 'Last name is required';

    // Type-specific validations
    const normalizedType = type ? type.toUpperCase() : 'INDIVIDUAL';

    if (normalizedType === 'COMPANY' && !companyName) {
        errors.companyName = 'Company name is required for Company tenants';
    }

    if (normalizedType === 'RESIDENT' && !parentId) {
        errors.parentId = 'Parent tenant (Responsible Party) is required for Residents';
    }

    // Phone Validation
    if (!phone) {
        errors.phone = 'Phone number is required';
    } else {
        // Normalize Phone (E.164 focus for Canadian/US)
        let cleanPhone = phone.replace(/[\s-()]/g, '');
        if (cleanPhone.length === 10 && /^\d+$/.test(cleanPhone)) {
            phone = '+1' + cleanPhone;
        } else if (cleanPhone.length === 11 && cleanPhone.startsWith('1')) {
            phone = '+' + cleanPhone;
        } else {
            phone = cleanPhone;
        }

        // Basic check: must be at least 10 digits
        if (phone.length < 10) {
            errors.phone = 'Invalid phone number format';
        }
    }

    if (Object.keys(errors).length > 0) {
        const err = new AppError('Validation failed', 400);
        err.errors = errors;
        throw err;
    }

    // 1. Password Logic (Moved to Lease Creation)
    let hashedPassword = null;

    // Transaction to ensure atomicity
    const result = await prisma.$transaction(async (prisma) => {
        // Check if email already exists (only if email is provided and not empty)
        if (email && email.trim() !== '') {
            const existingUser = await prisma.user.findUnique({
                where: { email: email.trim() }
            });

            if (existingUser) {
                const err = new AppError('A user with this email already exists', 409);
                err.errors = { email: 'This email is already registered.' };
                throw err;
            }
        }

        // 1. Create User (Tenant/Resident)
        const normalizedType = type ? type.toUpperCase() : 'INDIVIDUAL';
        let sanitizedParentId = (parentId && !isNaN(parseInt(parentId))) ? parseInt(parentId) : null;
        let sanitizedBuildingId = (propertyId && !isNaN(parseInt(propertyId))) ? parseInt(propertyId) : null;
        let sanitizedUnitId = (unitId && !isNaN(parseInt(unitId))) ? parseInt(unitId) : null;
        let sanitizedBedroomId = (bedroomId && !isNaN(parseInt(bedroomId))) ? parseInt(bedroomId) : null;

        if (normalizedType === 'RESIDENT') {
            if (!sanitizedParentId) {
                const err = new AppError('Responsible Party is required for Residents', 400);
                err.errors = { parentId: 'Responsible Party is required' };
                throw err;
            }

            // Residents inherit location from parent ALWAYS if not provided
            const parent = await prisma.user.findUnique({
                where: { id: sanitizedParentId },
                include: {
                    leases: { where: { status: 'Active' }, take: 1 }
                }
            });

            if (parent) {
                sanitizedBuildingId = sanitizedBuildingId || parent.buildingId;
                sanitizedUnitId = sanitizedUnitId || parent.unitId;
                sanitizedBedroomId = sanitizedBedroomId || parent.bedroomId;
                // STOPS: Linking resident to parent's lease. Residents should be occupants only.
                // req.body.leaseId = null; 
            }
        }

        const inviteToken = normalizedType !== 'RESIDENT' ? crypto.randomBytes(32).toString('hex') : null;
        const inviteExpires = normalizedType !== 'RESIDENT' ? new Date() : null;
        if (inviteExpires) inviteExpires.setDate(inviteExpires.getDate() + 7);

        const newUser = await prisma.user.create({
            data: {
                name: `${firstName} ${lastName}`.trim(),
                firstName,
                lastName,
                email: (email && email.trim() !== '') ? email.trim() : null,
                phone,
                type: normalizedType,
                companyName: normalizedType === 'COMPANY' ? (companyName || null) : null,
                companyDetails: normalizedType === 'COMPANY' ? (companyDetails || null) : null,
                street: street || null,
                city: city || null,
                state: state || null,
                postalCode: postalCode || null,
                country: country || null,
                role: 'TENANT',
                buildingId: sanitizedBuildingId,
                unitId: sanitizedUnitId,
                bedroomId: sanitizedBedroomId,
                parentId: sanitizedParentId,
                leaseId: normalizedType === 'RESIDENT' ? null : (req.body.leaseId || null), // Residents never have leases
                password: hashedPassword,
                inviteToken,
                inviteExpires,
            }
        });

        // Handle Company Contacts
        if (normalizedType === 'COMPANY' && req.body.companyContacts && Array.isArray(req.body.companyContacts)) {
            await prisma.companyContact.createMany({
                data: req.body.companyContacts.map(c => ({
                    companyId: newUser.id,
                    name: c.name,
                    email: c.email,
                    phone: c.phone,
                    role: c.role
                }))
            });
        }

        // 5. Handle Sub-Residents (If any provided for Individual/Company)
        if (normalizedType !== 'RESIDENT' && residents && Array.isArray(residents) && residents.length > 0) {
            await prisma.user.createMany({
                data: residents.filter(r => r.firstName || r.lastName).map(r => ({
                    firstName: r.firstName || '',
                    lastName: r.lastName || '',
                    name: `${r.firstName || ''} ${r.lastName || ''}`.trim(),
                    parentId: newUser.id,
                    role: 'TENANT',
                    type: 'RESIDENT'
                }))
            });
        }

        return newUser;
    });

    // Communication moved to Lease Creation flow

    res.status(201).json({
        success: true,
        message: 'Tenant created successfully.',
        data: result
    });
});


// DELETE
exports.deleteTenant = async (req, res) => {
    try {
        const id = parseInt(req.params.id);

        await prisma.$transaction(async (prisma) => {
            // 1. Find any lease (Active or Draft) to vacate unit and bedrooms
            const anyLease = await prisma.lease.findFirst({
                where: { tenantId: id, status: { in: ['Active', 'DRAFT'] } }
            });

            if (anyLease) {
                // Vacate all bedrooms in the unit
                await prisma.bedroom.updateMany({
                    where: { unitId: anyLease.unitId, status: 'Occupied' },
                    data: { status: 'Vacant' }
                });

                // Set unit to Vacant
                await prisma.unit.update({
                    where: { id: anyLease.unitId },
                    data: { status: 'Vacant' }
                });
            }

            // 2. Cleanup references (order matters: dependents before parents)
            await prisma.lease.deleteMany({ where: { tenantId: id } });
            await prisma.insurance.deleteMany({ where: { userId: id } });
            await prisma.document.deleteMany({ where: { userId: id } });
            await prisma.ticket.deleteMany({ where: { userId: id } });
            await prisma.refreshToken.deleteMany({ where: { userId: id } });
            // Invoice: delete Transaction -> Payment -> Invoice (FK order)
            const tenantInvoiceIds = (await prisma.invoice.findMany({ where: { tenantId: id }, select: { id: true } })).map(i => i.id);
            if (tenantInvoiceIds.length > 0) {
                const paymentIds = (await prisma.payment.findMany({ where: { invoiceId: { in: tenantInvoiceIds } }, select: { id: true } })).map(p => p.id);
                await prisma.transaction.deleteMany({ where: { OR: [{ invoiceId: { in: tenantInvoiceIds } }, { paymentId: { in: paymentIds } }] } });
                await prisma.payment.deleteMany({ where: { invoiceId: { in: tenantInvoiceIds } } });
            }
            await prisma.invoice.deleteMany({ where: { tenantId: id } });
            await prisma.refundAdjustment.deleteMany({ where: { tenantId: id } });
            // Residents: clean all FKs pointing to residents (including tenantId on Lease/Invoice/RefundAdjustment), then delete residents
            const residentIds = (await prisma.user.findMany({ where: { parentId: id }, select: { id: true } })).map(u => u.id);
            if (residentIds.length > 0) {
                await prisma.lease.deleteMany({ where: { tenantId: { in: residentIds } } });
                const residentInvoiceIds = (await prisma.invoice.findMany({ where: { tenantId: { in: residentIds } }, select: { id: true } })).map(i => i.id);
                if (residentInvoiceIds.length > 0) {
                    const residentPaymentIds = (await prisma.payment.findMany({ where: { invoiceId: { in: residentInvoiceIds } }, select: { id: true } })).map(p => p.id);
                    await prisma.transaction.deleteMany({ where: { OR: [{ invoiceId: { in: residentInvoiceIds } }, { paymentId: { in: residentPaymentIds } }] } });
                    await prisma.payment.deleteMany({ where: { invoiceId: { in: residentInvoiceIds } } });
                }
                await prisma.invoice.deleteMany({ where: { tenantId: { in: residentIds } } });
                await prisma.refundAdjustment.deleteMany({ where: { tenantId: { in: residentIds } } });
                await prisma.refreshToken.deleteMany({ where: { userId: { in: residentIds } } });
                await prisma.insurance.deleteMany({ where: { userId: { in: residentIds } } });
                await prisma.document.deleteMany({ where: { userId: { in: residentIds } } });
                await prisma.ticket.deleteMany({ where: { userId: { in: residentIds } } });
                await prisma.message.deleteMany({ where: { OR: [{ senderId: { in: residentIds } }, { receiverId: { in: residentIds } }] } });
                await prisma.communicationLog.deleteMany({ where: { recipientId: { in: residentIds } } });
                await prisma.quickBooksConfig.deleteMany({ where: { userId: { in: residentIds } } });
            }
            await prisma.user.deleteMany({ where: { parentId: id } });
            await prisma.companyContact.deleteMany({ where: { companyId: id } });
            await prisma.communicationLog.deleteMany({ where: { recipientId: id } });
            await prisma.quickBooksConfig.deleteMany({ where: { userId: id } });
            await prisma.message.deleteMany({
                where: {
                    OR: [
                        { senderId: id },
                        { receiverId: id }
                    ]
                }
            }); // Clean up messages
            // Also delete documents linked via DocumentLink
            const linkedDocuments = await prisma.document.findMany({
                where: {
                    links: {
                        some: {
                            entityType: 'USER',
                            entityId: id
                        }
                    }
                },
                select: { id: true }
            });
            if (linkedDocuments.length > 0) {
                const linkedDocIds = linkedDocuments.map(d => d.id);
                // Delete the DocumentLinks first
                await prisma.documentLink.deleteMany({
                    where: {
                        documentId: { in: linkedDocIds },
                        entityType: 'USER',
                        entityId: id
                    }
                });
            }

            // 3. Delete user
            await prisma.user.delete({ where: { id } });
        });

        res.json({ message: 'Deleted' });
    } catch (e) {
        console.error('Delete Tenant Error:', e);
        res.status(500).json({ message: 'Error deleting tenant' });
    }
};

// PUT /api/admin/tenants/:id
exports.updateTenant = catchAsync(async (req, res, next) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
        return next(new AppError('Invalid tenant ID', 400));
    }

    const {
        firstName, lastName, email, type, unitId, bedroomId, propertyId,
        companyName, companyDetails, residents, parentId,
        street, city, state, postalCode, country
    } = req.body;
    let { phone } = req.body;

    const errors = {};
    if (!firstName) errors.firstName = 'First name is required';
    if (!lastName) errors.lastName = 'Last name is required';

    // Phone Validation
    if (!phone) {
        errors.phone = 'Phone number is required';
    } else {
        // Normalize Phone
        let cleanPhone = phone.replace(/[\s-()]/g, '');
        if (cleanPhone.length === 10 && /^\d+$/.test(cleanPhone)) {
            phone = '+1' + cleanPhone;
        } else if (cleanPhone.length === 11 && cleanPhone.startsWith('1')) {
            phone = '+' + cleanPhone;
        } else {
            phone = cleanPhone;
        }
        if (phone.length < 10) {
            errors.phone = 'Invalid phone number format';
        }
    }

    if (Object.keys(errors).length > 0) {
        const err = new AppError('Validation failed', 400);
        err.errors = errors;
        throw err;
    }

    const normalizedType = type ? type.toUpperCase() : undefined;

    // Transaction
    const updatedTenant = await prisma.$transaction(async (prisma) => {
        // Check email uniqueness if email is provided
        if (email) {
            const existingUser = await prisma.user.findFirst({
                where: {
                    email,
                    id: { not: id } // Exclude self
                }
            });

            if (existingUser) {
                const err = new AppError('A user with this email already exists', 409);
                err.errors = { email: 'This email is already taken by another user.' };
                throw err;
            }
        }

        let sanitizedParentId = (parentId && !isNaN(parseInt(parentId))) ? parseInt(parentId) : (normalizedType === 'RESIDENT' ? undefined : null);
        let sanitizedBuildingId = propertyId ? parseInt(propertyId) : null;
        let sanitizedUnitId = unitId ? parseInt(unitId) : null;
        let sanitizedBedroomId = bedroomId ? parseInt(bedroomId) : null;
        let sanitizedLeaseId = req.body.leaseId ? parseInt(req.body.leaseId) : undefined;

        if (normalizedType === 'RESIDENT' && sanitizedParentId) {
            const parent = await prisma.user.findUnique({
                where: { id: sanitizedParentId },
                include: {
                    leases: { where: { status: 'Active' }, take: 1 }
                }
            });
            if (parent) {
                sanitizedBuildingId = sanitizedBuildingId || parent.buildingId;
                sanitizedUnitId = sanitizedUnitId || parent.unitId;
                sanitizedBedroomId = sanitizedBedroomId || parent.bedroomId;
                sanitizedLeaseId = null; // Residents never assigned to leases
            }
        }

        // 1. Update basic info
        const user = await prisma.user.update({
            where: { id },
            data: {
                name: `${firstName} ${lastName}`.trim(),
                firstName,
                lastName,
                email,
                phone,
                type: normalizedType,
                companyName: normalizedType === 'COMPANY' ? companyName : null,
                companyDetails: normalizedType === 'COMPANY' ? companyDetails : null,
                street: street || undefined,
                city: city || undefined,
                state: state || undefined,
                postalCode: postalCode || undefined,
                country: country || undefined,
                buildingId: sanitizedBuildingId,
                unitId: sanitizedUnitId,
                bedroomId: sanitizedBedroomId,
                parentId: sanitizedParentId !== undefined ? sanitizedParentId : null,
                leaseId: sanitizedLeaseId !== undefined ? sanitizedLeaseId : null
            }
        });

        // Handle Company Contacts Sync
        if (normalizedType === 'COMPANY' && req.body.companyContacts && Array.isArray(req.body.companyContacts)) {
            await prisma.companyContact.deleteMany({ where: { companyId: id } });
            await prisma.companyContact.createMany({
                data: req.body.companyContacts.map(c => ({
                    companyId: id,
                    name: c.name,
                    email: c.email,
                    phone: c.phone,
                    role: c.role
                }))
            });
        }

        // Sync Residents (for Individual/Company): clean resident-related data first, then delete, then create
        if (normalizedType !== 'RESIDENT' && residents && Array.isArray(residents)) {
            const currentLease = await prisma.lease.findFirst({
                where: { tenantId: id, status: { in: ['ACTIVE', 'Active', 'DRAFT'] } }
            });

            const residentIds = (await prisma.user.findMany({ where: { parentId: id }, select: { id: true } })).map(u => u.id);
            if (residentIds.length > 0) {
                await prisma.refreshToken.deleteMany({ where: { userId: { in: residentIds } } });
                await prisma.insurance.deleteMany({ where: { userId: { in: residentIds } } });
                await prisma.document.deleteMany({ where: { userId: { in: residentIds } } });
                await prisma.ticket.deleteMany({ where: { userId: { in: residentIds } } });
                await prisma.message.deleteMany({ where: { OR: [{ senderId: { in: residentIds } }, { receiverId: { in: residentIds } }] } });
                await prisma.communicationLog.deleteMany({ where: { recipientId: { in: residentIds } } });
                await prisma.quickBooksConfig.deleteMany({ where: { userId: { in: residentIds } } });
            }
            await prisma.user.deleteMany({ where: { parentId: id } });
            if (residents.length > 0) {
                await prisma.user.createMany({
                    data: residents.filter(r => r.firstName || r.lastName).map(r => ({
                        parentId: id,
                        leaseId: currentLease?.id ?? null,
                        firstName: r.firstName || '',
                        lastName: r.lastName || '',
                        name: `${r.firstName || ''} ${r.lastName || ''}`.trim(),
                        role: 'TENANT',
                        type: 'RESIDENT'
                    }))
                });
            }
        }

        return user;
    });

    // 3. Handle Bedroom/Unit Change (Logic now relies on the transaction result or parameters)
    // NOTE: This logic was outside transaction in original code. 
    // Ideally it should be inside or handled safely. 
    // Keeping logic structure but ensuring errors bubble up.

    let newUnitId = unitId ? parseInt(unitId) : null;
    let newBedroomId = bedroomId ? parseInt(bedroomId) : null;

    if (newBedroomId) {
        const bedroom = await prisma.bedroom.findUnique({
            where: { id: newBedroomId }
        });
        if (bedroom) {
            newUnitId = bedroom.unitId;
        }
    }

    if (newUnitId && normalizedType !== 'RESIDENT') {
        const currentLease = await prisma.lease.findFirst({
            where: {
                tenantId: id,
                status: { in: ['ACTIVE', 'Active', 'DRAFT'] }
            }
        });

        if (currentLease && currentLease.unitId !== newUnitId) {
            // Logic to move lease
            if (currentLease.status === 'ACTIVE' || currentLease.status === 'Active') {
                await prisma.lease.update({
                    where: { id: currentLease.id },
                    data: { status: 'MOVED', endDate: new Date() }
                });

                await prisma.lease.create({
                    data: {
                        tenantId: id,
                        unitId: newUnitId,
                        bedroomId: newBedroomId || null,
                        status: 'ACTIVE',
                    }
                });
            } else {
                await prisma.lease.update({
                    where: { id: currentLease.id },
                    data: {
                        unitId: newUnitId,
                        bedroomId: newBedroomId || null
                    }
                });
            }
        } else if (!currentLease) {
            // Logic to create new lease if none existed (implied by original code logic flow)
            await prisma.lease.create({
                data: {
                    tenantId: id,
                    unitId: newUnitId,
                    bedroomId: newBedroomId || null,
                    status: 'ACTIVE',
                }
            });
        }
    }

    res.json({
        success: true,
        message: 'Tenant updated successfully',
        data: updatedTenant
    });
});

// GET /api/admin/tenants/:id/tickets
exports.getTenantTickets = async (req, res) => {
    try {
        const { id } = req.params;
        const tickets = await prisma.ticket.findMany({
            where: { userId: parseInt(id) },
            orderBy: { createdAt: 'desc' }
        });

        const formatted = tickets.map(t => ({
            id: t.id + 1000,
            title: t.subject,
            category: 'General', // Fallback as schema doesn't have category
            priority: t.priority,
            status: t.status,
            date: t.createdAt.toISOString().split('T')[0]
        }));

        res.json(formatted);
    } catch (error) {
        console.error('Fetch Tenant Tickets Error:', error);
        res.status(500).json({ message: 'Server error' });
    }
};

// POST /api/admin/tenants/:id/send-invite
exports.sendInvite = catchAsync(async (req, res, next) => {
    const id = parseInt(req.params.id);
    const { methods } = req.body; // ['email', 'sms']

    if (isNaN(id)) {
        throw new AppError('Invalid tenant ID', 400);
    }

    if (!methods || !Array.isArray(methods) || methods.length === 0) {
        throw new AppError('Please select at least one delivery method (Email or SMS)', 400);
    }

    const tenant = await prisma.user.findUnique({
        where: { id },
        include: { parent: true }
    });

    if (!tenant) {
        throw new AppError('Tenant not found', 404);
    }

    // Block invitations for residents
    if (tenant.type === 'RESIDENT') {
        throw new AppError('Residents do not have portal access and cannot be invited.', 400);
    }

    const recipientUser = tenant;

    let password = null;
    let hashedPassword = undefined;

    // If user has no password, generate one
    if (!recipientUser.password) {
        password = Math.floor(100000 + Math.random() * 900000).toString();
        hashedPassword = await bcrypt.hash(password, 10);
    }

    const inviteToken = crypto.randomBytes(32).toString('hex');
    const inviteExpires = new Date();
    inviteExpires.setDate(inviteExpires.getDate() + 7);

    // Update recipient with new credentials/token
    const updatedUser = await prisma.user.update({
        where: { id: recipientUser.id },
        data: {
            ...(hashedPassword ? { password: hashedPassword } : {}),
            inviteToken,
            inviteExpires
        }
    });

    const loginUrl = process.env.FRONTEND_URL || 'https://property-n.kiaantechnology.com';
    const inviteLink = `${loginUrl}/tenant/invite/${inviteToken}`;

    let welcomeMsg = `Welcome to Property Management! \n\nYour login credentials for the portal: \nEmail: ${updatedUser.email}`;
    if (password) {
        welcomeMsg += ` \nPassword: ${password}`;
    }
    welcomeMsg += ` \n\nAccess your portal here: ${inviteLink}`;

    const results = {
        email: { attempted: false, success: false },
        sms: { attempted: false, success: false }
    };

    if (methods.includes('email')) {
        results.email.attempted = true;
        if (!updatedUser.email) {
            results.email.error = 'No email address on file';
        } else {
            try {
                const eRes = await emailService.sendEmail(updatedUser.email, 'Welcome - Your Portal Access', welcomeMsg);
                results.email.success = eRes.success;
                if (!eRes.success) results.email.error = eRes.error;
            } catch (err) {
                results.email.error = err.message;
            }
        }
    }

    if (methods.includes('sms')) {
        results.sms.attempted = true;
        if (!updatedUser.phone) {
            results.sms.error = 'No phone number on file';
        } else {
            try {
                const sRes = await smsService.sendSMS(updatedUser.phone, welcomeMsg);
                results.sms.success = sRes.success;
                if (!sRes.success) results.sms.error = sRes.error;
            } catch (err) {
                results.sms.error = err.message;
            }
        }
    }

    res.json({
        success: true,
        message: 'Invitations processed',
        data: {
            recipient: updatedUser.email,
            results,
            inviteLink // Still return for admin convenience
        }
    });
});

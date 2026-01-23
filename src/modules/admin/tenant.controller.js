const bcrypt = require('bcrypt');
const crypto = require('crypto');
const prisma = require('../../config/prisma');
const smsService = require('../../services/sms.service');

// GET /api/admin/tenants
exports.getAllTenants = async (req, res) => {
    try {
        const { propertyId } = req.query;
        const whereClause = { role: 'TENANT' };

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
                residents: true
            }
        });

        const formatted = tenants.map(t => {
            // Find active lease first, then fall back to DRAFT
            const activeLease = t.leases.find(l => l.status === 'Active') || t.leases.find(l => l.status === 'DRAFT');

            return {
                id: t.id,
                name: t.name || `${t.firstName || ''} ${t.lastName || ''}`.trim(),
                firstName: t.firstName,
                lastName: t.lastName,
                type: t.type || 'Individual',
                companyName: t.companyName,
                companyDetails: t.companyDetails,
                email: t.email,
                phone: t.phone,
                propertyId: activeLease?.unit?.propertyId || t.buildingId || null,
                unitId: activeLease?.unitId || t.unitId || null,
                bedroomId: activeLease?.bedroomId || t.bedroomId || null,
                property: activeLease?.unit?.property?.name || 'No Property',
                unit: activeLease?.unit?.name || 'No Unit',
                leaseStatus: activeLease ? activeLease.status : 'Inactive',
                leaseStartDate: activeLease?.startDate || null,
                leaseEndDate: activeLease?.endDate || null,
                rentAmount: activeLease?.monthlyRent || 0,
                insurance: t.insurances,
                documents: t.documents,
                residents: t.residents,
                inviteToken: t.inviteToken,
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
        
        const tenant = await prisma.user.findUnique({
            where: { id: tenantId },
            include: {
                leases: {
                    include: { unit: true }
                },
                insurances: true,
                documents: true, // Direct ownership documents
                residents: true
            }
        });

        if (!tenant) return res.status(404).json({ message: 'Tenant not found' });

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
exports.createTenant = async (req, res) => {
    try {
        const { firstName, lastName, email, phone, type, unitId, bedroomId, propertyId, companyName, companyDetails, residents } = req.body;
        let { password } = req.body;

        // Generate a random numeric password for the tenant if none provided
        if (!password) {
            //password = Math.floor(100000 + Math.random() * 900000).toString(); // 6-digit random number
            password = '123456';
        }

        // Transaction to ensure atomicity
        const result = await prisma.$transaction(async (prisma) => {
            // Check if email already exists
            const existingUser = await prisma.user.findUnique({
                where: { email }
            });

            if (existingUser) {
                throw new Error('A user with this email already exists');
            }

            // 1. Create User (Tenant)
            const inviteToken = crypto.randomBytes(32).toString('hex');
            const inviteExpires = new Date();
            inviteExpires.setDate(inviteExpires.getDate() + 7); // 7 days

            const newUser = await prisma.user.create({
                data: {
                    name: `${firstName} ${lastName}`.trim(),
                    firstName,
                    lastName,
                    email,
                    phone,
                    type: type ? type.toUpperCase() : 'INDIVIDUAL',
                    companyName: type === 'COMPANY' || type === 'Company' ? companyName : null,
                    companyDetails: type === 'COMPANY' || type === 'Company' ? companyDetails : null,
                    street: req.body.street || null,
                    city: req.body.city || null,
                    state: req.body.state || null,
                    postalCode: req.body.postalCode || null,
                    country: req.body.country || null,
                    role: 'TENANT',
                    buildingId: propertyId ? parseInt(propertyId) : null,
                    unitId: unitId ? parseInt(unitId) : null,
                    bedroomId: bedroomId ? parseInt(bedroomId) : null,
                    password: await bcrypt.hash(password, 10),
                    inviteToken,
                    inviteExpires,
                }
            });

            // Handle Company Contacts
            if ((type === 'COMPANY' || type === 'Company') && req.body.companyContacts && Array.isArray(req.body.companyContacts)) {
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

            // 3. Handle Lease & Bedroom Logic
            let finalUnitId = unitId ? parseInt(unitId) : null;
            let finalBedroomId = bedroomId ? parseInt(bedroomId) : null;

            if (finalBedroomId) {
                const bedroom = await prisma.bedroom.findUnique({
                    where: { id: finalBedroomId }
                });
                if (bedroom) {
                    finalUnitId = bedroom.unitId;
                }
            }

            // 4. Create Lease
            // let newLeaseId = null;
            // if (finalUnitId) {
            //     const newLease = await prisma.lease.create({
            //         data: {
            //             tenantId: newUser.id,
            //             unitId: finalUnitId,
            //             bedroomId: finalBedroomId || null,
            //             status: 'ACTIVE', // Default to active for simple setup
            //         }
            //     });
            //     newLeaseId = newLease.id;
            // }

            // 5. Handle Residents
            if (residents && Array.isArray(residents) && residents.length > 0) {
                await prisma.resident.createMany({
                    data: residents.filter(r => r.firstName || r.lastName).map(r => ({
                        tenantId: newUser.id,
                        leaseId: newLeaseId,
                        firstName: r.firstName || '',
                        lastName: r.lastName || '',
                    }))
                });
            }

            return newUser;
        });

        // Send SMS outside transaction
        let smsResult = { success: false, note: "Skipped" };
        if (phone) {
            const message = `Welcome to Property Management! \n\nYour login credentials: \nEmail: ${email} \nPassword: ${password} \n\nLogin here: ${process.env.FRONTEND_URL || 'https://property-n.kiaantechnology.com'}/login`;
            console.log('Attempting to send SMS to:', phone);
            smsResult = await smsService.sendSMS(phone, message);
        }

        res.status(201).json({ ...result, smsResult });
    } catch (error) {
        console.error('Create Tenant Error:', error);
        res.status(500).json({ message: error.message || 'Could not create tenant.' });
    }
};


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

            // 2. Cleanup references
            // Note: In production with proper FK constraints, some of this might be CASCADE.
            // But manually cleaning is safer here.
            await prisma.lease.deleteMany({ where: { tenantId: id } });
            await prisma.insurance.deleteMany({ where: { userId: id } });
            await prisma.document.deleteMany({ where: { userId: id } });
            await prisma.ticket.deleteMany({ where: { userId: id } });
            await prisma.refreshToken.deleteMany({ where: { userId: id } });
            await prisma.invoice.deleteMany({ where: { tenantId: id } }); // Fix for FK constraint
            await prisma.refundAdjustment.deleteMany({ where: { tenantId: id } }); // Fix for FK constraint
            await prisma.resident.deleteMany({ where: { tenantId: id } }); // Delete residents linked to this tenant
            await prisma.companyContact.deleteMany({ where: { companyId: id } }); // Delete company contacts if this is a company tenant
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
exports.updateTenant = async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const { firstName, lastName, email, phone, type, unitId, bedroomId, propertyId, companyName, companyDetails, residents } = req.body;

        const updatedTenant = await prisma.$transaction(async (prisma) => {
            // 1. Update basic info
            const user = await prisma.user.update({
                where: { id },
                data: {
                    name: `${firstName} ${lastName}`.trim(),
                    firstName,
                    lastName,
                    email,
                    phone,
                    type: type ? type.toUpperCase() : undefined,
                    companyName: type === 'COMPANY' || type === 'Company' ? companyName : null,
                    companyDetails: type === 'COMPANY' || type === 'Company' ? companyDetails : null,
                    street: req.body.street || undefined,
                    city: req.body.city || undefined,
                    state: req.body.state || undefined,
                    postalCode: req.body.postalCode || undefined,
                    country: req.body.country || undefined,
                    buildingId: propertyId ? parseInt(propertyId) : null,
                    unitId: unitId ? parseInt(unitId) : null,
                    bedroomId: bedroomId ? parseInt(bedroomId) : null
                }
            });

            // Handle Company Contacts Sync
            if ((type === 'COMPANY' || type === 'Company') && req.body.companyContacts && Array.isArray(req.body.companyContacts)) {
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

            // Sync Residents
            if (residents && Array.isArray(residents)) {
                const currentLease = await prisma.lease.findFirst({
                    where: { tenantId: id, status: { in: ['ACTIVE', 'Active', 'DRAFT'] } }
                });

                await prisma.resident.deleteMany({ where: { tenantId: id } });
                if (residents.length > 0) {
                    await prisma.resident.createMany({
                        data: residents.filter(r => r.firstName || r.lastName).map(r => ({
                            tenantId: id,
                            leaseId: currentLease?.id,
                            firstName: r.firstName || '',
                            lastName: r.lastName || '',
                        }))
                    });
                }
            }

            // 3. Handle Bedroom/Unit Change
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

            if (newUnitId) {
                const currentLease = await prisma.lease.findFirst({
                    where: {
                        tenantId: id,
                        status: { in: ['ACTIVE', 'Active', 'DRAFT'] }
                    }
                });

                if (currentLease && currentLease.unitId !== newUnitId) {
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

            return user;
        });

        res.json(updatedTenant);
    } catch (error) {
        console.error('Update Tenant Error:', error);
        res.status(500).json({ message: 'Error updating tenant' });
    }
};

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
exports.sendInvite = async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const inviteToken = crypto.randomBytes(32).toString('hex');
        const inviteExpires = new Date();
        inviteExpires.setDate(inviteExpires.getDate() + 7);

        const user = await prisma.user.update({
            where: { id },
            data: { inviteToken, inviteExpires }
        });

        // In a real system, send email here. 
        // For now, we return the token/link for the admin to use or verify.
        res.json({
            message: 'Invite generated successfully',
            inviteToken: user.inviteToken,
            inviteLink: `${process.env.FRONTEND_URL || `https://property-n.kiaantechnology.com` || 'http://localhost:5173'}/tenant/invite/${user.inviteToken}`
        });
    } catch (error) {
        console.error('Send Invite Error:', error);
        res.status(500).json({ message: 'Error generating invite' });
    }
};

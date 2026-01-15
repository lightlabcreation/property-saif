const prisma = require('../../config/prisma');
const bcrypt = require('bcrypt');

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
                documents: true
            }
        });

        const formatted = tenants.map(t => {
            // Find active lease first, then fall back to DRAFT
            const activeLease = t.leases.find(l => l.status === 'Active') || t.leases.find(l => l.status === 'DRAFT');

            return {
                id: t.id,
                name: t.name,
                type: t.type || 'Individual',
                email: t.email,
                phone: t.phone,
                propertyId: activeLease?.unit?.propertyId || null,
                unitId: activeLease?.unitId || null,
                property: activeLease?.unit?.property?.name || 'No Property',
                unit: activeLease?.unit?.name || 'No Unit',
                leaseStatus: activeLease ? activeLease.status : 'Inactive',
                leaseStartDate: activeLease?.startDate || null,
                leaseEndDate: activeLease?.endDate || null,
                insurance: t.insurances,
                documents: t.documents
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
        const tenant = await prisma.user.findUnique({
            where: { id: parseInt(id) },
            include: {
                leases: {
                    include: { unit: true }
                },
                insurances: true,
                documents: true
            }
        });

        if (!tenant) return res.status(404).json({ message: 'Tenant not found' });

        res.json(tenant);
    } catch (error) {
        res.status(500).json({ message: 'Server error' });
    }
};

// POST /api/admin/tenants
exports.createTenant = async (req, res) => {
    try {
        const { name, email, password, phone, type, unitId, bedroomId } = req.body;

        // Hash password
        const hashedPassword = await bcrypt.hash(password || '123456', 10);

        // Transaction to ensure atomicity
        const result = await prisma.$transaction(async (prisma) => {
            // 1. Create User
            const newUser = await prisma.user.create({
                data: {
                    name,
                    email,
                    password: hashedPassword,
                    phone,
                    type,
                    role: 'TENANT'
                }
            });

            // 2. If Bedroom selected, get unitId from bedroom and create lease
            let finalUnitId = unitId ? parseInt(unitId) : null;

            if (bedroomId) {
                const bId = parseInt(bedroomId);
                const bedroom = await prisma.bedroom.findUnique({
                    where: { id: bId }
                });

                if (bedroom) {
                    finalUnitId = bedroom.unitId;

                    // Mark bedroom as Occupied
                    await prisma.bedroom.update({
                        where: { id: bId },
                        data: { status: 'Occupied' }
                    });
                }
            }

            // 3. If Unit available, Create Lease
            if (finalUnitId) {
                // Create placeholder DRAFT lease
                await prisma.lease.create({
                    data: {
                        tenantId: newUser.id,
                        unitId: finalUnitId,
                        status: 'DRAFT',
                        // NO dates, NO rent as per requirement
                    }
                });

                // Note: Unit status is updated to Occupied only when lease becomes Active
            }

            return newUser;
        });

        res.status(201).json(result);
    } catch (error) {
        console.error('Create Tenant Error:', error);
        res.status(500).json({ message: 'Could not create tenant. Email might be duplicate.' });
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
            await prisma.message.deleteMany({
                where: {
                    OR: [
                        { senderId: id },
                        { receiverId: id }
                    ]
                }
            }); // Clean up messages

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
        const { name, email, phone, type, unitId, bedroomId } = req.body;

        const updatedTenant = await prisma.$transaction(async (prisma) => {
            // 1. Update basic info
            const user = await prisma.user.update({
                where: { id },
                data: { name, email, phone, type }
            });

            // 2. Handle Bedroom/Unit Change
            let newUnitId = unitId ? parseInt(unitId) : null;
            let newBedroomId = bedroomId ? parseInt(bedroomId) : null;

            // If bedroomId provided, get unitId from bedroom
            if (newBedroomId) {
                const bedroom = await prisma.bedroom.findUnique({
                    where: { id: newBedroomId }
                });
                if (bedroom) {
                    newUnitId = bedroom.unitId;
                }
            }

            if (newUnitId) {
                // Find any current lease (Active or Draft)
                const currentLease = await prisma.lease.findFirst({
                    where: {
                        tenantId: id,
                        status: { in: ['Active', 'DRAFT'] }
                    }
                });

                // If switching units (and strictly if unitId is different)
                if (currentLease && currentLease.unitId !== newUnitId) {
                    // A. Vacate old bedroom if it was bedroom-wise
                    // Find bedrooms in old unit that might be occupied by this tenant
                    const oldBedrooms = await prisma.bedroom.findMany({
                        where: { unitId: currentLease.unitId, status: 'Occupied' }
                    });
                    // Mark all as vacant (simplified - in a more complex system, track which bedroom belongs to which tenant)
                    for (const ob of oldBedrooms) {
                        await prisma.bedroom.update({
                            where: { id: ob.id },
                            data: { status: 'Vacant' }
                        });
                    }

                    // B. Vacate old unit
                    await prisma.unit.update({
                        where: { id: currentLease.unitId },
                        data: { status: 'Vacant' }
                    });

                    // C. Handle old lease
                    if (currentLease.status === 'Active') {
                        // Terminate old active lease
                        await prisma.lease.update({
                            where: { id: currentLease.id },
                            data: { status: 'Moved', endDate: new Date() }
                        });

                        // Create new DRAFT for the new unit
                        await prisma.lease.create({
                            data: {
                                tenantId: id,
                                unitId: newUnitId,
                                status: 'DRAFT',
                            }
                        });
                    } else {
                        // If it was just a DRAFT, just update it to the new unit
                        await prisma.lease.update({
                            where: { id: currentLease.id },
                            data: { unitId: newUnitId }
                        });
                    }

                    // D. Mark new bedroom as Occupied
                    if (newBedroomId) {
                        await prisma.bedroom.update({
                            where: { id: newBedroomId },
                            data: { status: 'Occupied' }
                        });
                    }

                    // E. Occupy new unit (only if lease is active, otherwise wait)
                    // await prisma.unit.update({
                    //     where: { id: newUnitId },
                    //     data: { status: 'Occupied' }
                    // });
                }
                // If no lease at all exists for this tenant, create one
                else if (!currentLease) {
                    await prisma.lease.create({
                        data: {
                            tenantId: id,
                            unitId: newUnitId,
                            status: 'DRAFT',
                        }
                    });

                    // Mark new bedroom as Occupied
                    if (newBedroomId) {
                        await prisma.bedroom.update({
                            where: { id: newBedroomId },
                            data: { status: 'Occupied' }
                        });
                    }
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

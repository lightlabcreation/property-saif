const prisma = require('../../config/prisma');
const bcrypt = require('bcrypt');
const smsService = require('../../services/sms.service');
const emailService = require('../../services/email.service');
const crypto = require('crypto');

exports.getDashboardStats = async (req, res) => {
    try {
        const { ownerId } = req.query;
        console.log('Dashboard Stats - Received ownerId:', ownerId);
        const parsedOwnerId = ownerId && ownerId !== 'null' && ownerId !== '' ? parseInt(ownerId) : null;

        let propertyIds = [];
        if (parsedOwnerId) {
            const ownerProperties = await prisma.property.findMany({
                where: {
                    owners: {
                        some: { id: parsedOwnerId }
                    }
                },
                select: { id: true }
            });
            propertyIds = ownerProperties.map(p => p.id);
            console.log('Dashboard Stats - Owner Property IDs:', propertyIds);
        }

        // Base filters
        const propertyOnlyFilter = parsedOwnerId ? {
            owners: {
                some: { id: parsedOwnerId }
            }
        } : {};
        const unitFilter = parsedOwnerId ? { propertyId: { in: propertyIds } } : {};
        const genericFilter = parsedOwnerId ? { unit: { propertyId: { in: propertyIds } } } : {};

        // 1. Total Properties
        const totalProperties = await prisma.property.count({
            where: propertyOnlyFilter
        });

        // 2. Total Units
        const totalUnits = await prisma.unit.count({
            where: unitFilter
        });

        // 3. Occupancy (Occupied vs Vacant)
        const occupiedUnits = await prisma.unit.count({
            where: {
                status: 'Occupied',
                ...unitFilter
            },
        });
        const vacantUnits = totalUnits - occupiedUnits;

        // 4. Revenue Calculation
        const leaseAgg = await prisma.lease.aggregate({
            where: {
                status: 'Active',
                unit: { propertyId: { in: propertyIds } }
            },
            _sum: { monthlyRent: true }
        });
        const projectedRevenue = parseFloat(leaseAgg._sum.monthlyRent) || 0;

        const invoiceAgg = await prisma.invoice.aggregate({
            where: {
                unit: { propertyId: { in: propertyIds } }
            },
            _sum: { paidAmount: true }
        });
        const actualRevenue = parseFloat(invoiceAgg._sum.paidAmount) || 0;

        // 5. Recent Activity (Tickets - Using ID filter for safety)
        const recentTickets = await prisma.ticket.findMany({
            where: parsedOwnerId ? {
                OR: [
                    { propertyId: { in: propertyIds } },
                    { unitId: { in: propertyIds.length > 0 ? (await prisma.unit.findMany({ where: { propertyId: { in: propertyIds } }, select: { id: true } })).map(u => u.id) : [] } }
                ]
            } : {},
            take: 5,
            orderBy: { createdAt: 'desc' },
            include: { user: true }
        });
        const recentActivity = recentTickets.map(t => `${t.user?.name || 'Someone'} created ticket: ${t.subject}`);

        // 6. Insurance Alerts
        const today = new Date();
        const insuranceFilter = parsedOwnerId ? {
            OR: [
                { unit: { propertyId: { in: propertyIds } } },
                { lease: { unit: { propertyId: { in: propertyIds } } } }
            ]
        } : {};

        const expiredInsurance = await prisma.insurance.count({
            where: {
                endDate: { lt: today },
                ...insuranceFilter
            }
        });

        const soonDate = new Date();
        soonDate.setDate(today.getDate() + 30);
        const expiringSoon = await prisma.insurance.count({
            where: {
                endDate: { gt: today, lte: soonDate },
                ...insuranceFilter
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

exports.getAvailableProperties = async (req, res) => {
    try {
        const { ownerId } = req.query;
        console.log('Fetching available properties. OwnerId param:', ownerId);

        const whereClause = {
            status: 'Active'
        };

        // Since we are now Many-to-Many, any active property is 'available' to be 
        // added to an owner's portfolio, regardless of whether it has other owners.
        // The frontend will filter out properties already linked to the specific owner.
        console.log('Query where clause:', JSON.stringify(whereClause, null, 2));

        const properties = await prisma.property.findMany({
            where: whereClause,
            include: {
                units: {
                    select: {
                        status: true
                    }
                },
                owners: {
                    select: {
                        id: true,
                        name: true
                    }
                }
            }
        });

        console.log(`Found ${properties.length} available properties`);

        const formatted = properties.map(p => ({
            id: p.id,
            name: p.name,
            address: p.address,
            units: p.units.length,
            status: p.status,
            ownerIds: p.owners?.map(o => o.id) || []
        }));

        res.json(formatted);
    } catch (error) {
        console.error('Get Available Properties Error:', error);
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
                },
                owners: {
                    select: {
                        id: true,
                        name: true
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
                civicNumber: p.civicNumber,
                street: p.street,
                city: p.city,
                province: p.province,
                postalCode: p.postalCode,
                units: totalUnits,
                occupancy: `${occupancyRate}%`,
                status: p.status,
                ownerNames: p.owners?.map(o => o.name).join(', ') || 'No Owner',
                ownerIds: p.owners?.map(o => o.id) || []
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
                },
                owners: {
                    select: {
                        id: true,
                        name: true
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
            owners: property.owners,
            units: formattedUnits
        });

    } catch (error) {
        console.error('Get Property Details Error:', error);
        res.status(500).json({ message: 'Server error' });
    }
};

exports.createProperty = async (req, res) => {
    try {
        const { name, units, status, ownerId, address, civicNumber, street, city, province, postalCode } = req.body;

        // Build full address from components if provided
        let fullAddress = address || "Not Provided";
        if (civicNumber && street) {
            fullAddress = `${civicNumber} ${street}`;
            if (city) fullAddress += `, ${city}`;
            if (province) fullAddress += `, ${province}`;
            if (postalCode) fullAddress += ` ${postalCode}`;
        }

        // Create property without auto-generating units
        // Units should be created explicitly by the user, not automatically
        const property = await prisma.property.create({
            data: {
                name,
                status,
                address: fullAddress,
                civicNumber: civicNumber || null,
                street: street || null,
                city: city || null,
                province: province || null,
                postalCode: postalCode || null,
                owners: {
                    connect: req.body.ownerIds && Array.isArray(req.body.ownerIds)
                        ? req.body.ownerIds.map(id => ({ id: parseInt(id) }))
                        : (ownerId ? [{ id: parseInt(ownerId) }] : [])
                }
            },
            include: { units: true, owners: true }
        });

        res.json({
            id: property.id,
            name: property.name,
            address: property.address,
            civicNumber: property.civicNumber,
            street: property.street,
            city: property.city,
            province: property.province,
            province: property.province,
            postalCode: property.postalCode,
            units: property.units.length,
            status: property.status,
            ownerNames: property.owners?.map(o => o.name).join(', ') || 'No Owner'
        });
    } catch (error) {
        console.error('Create Property Error:', error);
        res.status(500).json({ message: 'Server error' });
    }
};

exports.updateProperty = async (req, res) => {
    try {
        const { id } = req.params;
        const { name, units, status, civicNumber, street, city, province, postalCode } = req.body;

        // First, get the current property to check unit count
        const currentProperty = await prisma.property.findUnique({
            where: { id: parseInt(id) },
            include: { units: true }
        });

        if (!currentProperty) {
            return res.status(404).json({ message: 'Property not found' });
        }

        // Build full address from components if provided
        let fullAddress = currentProperty.address;
        if (civicNumber && street) {
            fullAddress = `${civicNumber} ${street}`;
            if (city) fullAddress += `, ${city}`;
            if (province) fullAddress += `, ${province}`;
            if (postalCode) fullAddress += ` ${postalCode}`;
        }

        const updateData = {
            name,
            status,
            address: fullAddress,
            civicNumber: civicNumber !== undefined ? civicNumber : currentProperty.civicNumber,
            street: street !== undefined ? street : currentProperty.street,
            city: city !== undefined ? city : currentProperty.city,
            province: province !== undefined ? province : currentProperty.province,
            postalCode: postalCode !== undefined ? postalCode : currentProperty.postalCode
        };

        if (req.body.ownerIds && Array.isArray(req.body.ownerIds)) {
            updateData.owners = {
                set: req.body.ownerIds.map(id => ({ id: parseInt(id) }))
            };
        }

        // Update property name, status and address fields
        await prisma.property.update({
            where: { id: parseInt(id) },
            data: updateData
        });

        // Note: Units are no longer auto-created or deleted based on count
        // Units should be managed explicitly by the user through unit management endpoints

        // Refetch to get updated property with current unit count
        const updatedProperty = await prisma.property.findUnique({
            where: { id: parseInt(id) },
            include: { units: true }
        });

        res.json({
            id: updatedProperty.id,
            name: updatedProperty.name,
            address: updatedProperty.address,
            civicNumber: updatedProperty.civicNumber,
            street: updatedProperty.street,
            city: updatedProperty.city,
            province: updatedProperty.province,
            postalCode: updatedProperty.postalCode,
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
        const propertyId = parseInt(id);

        console.log(`[deleteProperty] Initiating deletion for Property ID: ${propertyId}`);

        // 1. Gather all related IDs to scope the deletion
        // We need Units to find Leases, Bedrooms, Invoices, etc.
        const units = await prisma.unit.findMany({
            where: { propertyId: propertyId },
            select: { id: true }
        });
        const unitIds = units.map(u => u.id);

        const bedrooms = await prisma.bedroom.findMany({
            where: { unitId: { in: unitIds } },
            select: { id: true }
        });
        const bedroomIds = bedrooms.map(b => b.id);

        const leases = await prisma.lease.findMany({
            where: { unitId: { in: unitIds } },
            select: { id: true }
        });
        const leaseIds = leases.map(l => l.id);

        const invoices = await prisma.invoice.findMany({
            where: {
                OR: [
                    { unitId: { in: unitIds } },
                    { leaseId: { in: leaseIds } }
                ]
            },
            select: { id: true }
        });
        const invoiceIds = invoices.map(i => i.id);

        const payments = await prisma.payment.findMany({
            where: { invoiceId: { in: invoiceIds } },
            select: { id: true }
        });
        const paymentIds = payments.map(p => p.id);

        console.log(`[deleteProperty] Found related entities: ${unitIds.length} Units, ${leaseIds.length} Leases, ${invoiceIds.length} Invoices`);

        // 2. Execute Deletions in strict order to avoid FK constraints
        await prisma.$transaction(async (tx) => {
            // A. Transactions (Dependent on Invoices/Payments)
            await tx.transaction.deleteMany({
                where: {
                    OR: [
                        { invoiceId: { in: invoiceIds } },
                        { paymentId: { in: paymentIds } }
                    ]
                }
            });

            // B. Payments (Dependent on Invoices)
            await tx.payment.deleteMany({
                where: { id: { in: paymentIds } }
            });

            // C. Insurance (Dependent on Unit/Lease) - Must delete before Documents if docs rely on it, 
            //    BUT Insurance refers to Document. So delete Insurance first to free up Document?
            //    Answer: Insurance -> Document (via uploadedDocumentId). Delete Insurance first.
            await tx.insurance.deleteMany({
                where: {
                    OR: [
                        { unitId: { in: unitIds } },
                        { leaseId: { in: leaseIds } }
                    ]
                }
            });

            // D. Documents (Dependent on Property/Unit/Lease/Invoice)
            await tx.document.deleteMany({
                where: {
                    OR: [
                        { propertyId: propertyId },
                        { unitId: { in: unitIds } },
                        { leaseId: { in: leaseIds } },
                        { invoiceId: { in: invoiceIds } }
                    ]
                }
            });

            // E. RefundAdjustments (Dependent on Unit)
            await tx.refundAdjustment.deleteMany({
                where: { unitId: { in: unitIds } }
            });

            // F. Tickets (Dependent on Property/Unit)
            await tx.ticket.deleteMany({
                where: {
                    OR: [
                        { propertyId: propertyId },
                        { unitId: { in: unitIds } }
                    ]
                }
            });

            // G. Invoices (Dependent on Unit/Lease)
            await tx.invoice.deleteMany({
                where: { id: { in: invoiceIds } }
            });

            // H. Unlink Users (Tenants/Residents) from Units/Leases/Bedrooms
            //    We do NOT delete the User, just clear the reference.
            await tx.user.updateMany({
                where: { leaseId: { in: leaseIds } },
                data: { leaseId: null }
            });
            await tx.user.updateMany({
                where: { unitId: { in: unitIds } },
                data: { unitId: null }
            });
            await tx.user.updateMany({
                where: { bedroomId: { in: bedroomIds } },
                data: { bedroomId: null }
            });

            // I. Leases (Dependent on Unit/Bedroom)
            await tx.lease.deleteMany({
                where: { id: { in: leaseIds } }
            });

            // J. Bedrooms (Dependent on Unit)
            await tx.bedroom.deleteMany({
                where: { id: { in: bedroomIds } }
            });

            // K. Maintenance Tasks (Dependent on Property)
            await tx.maintenanceTask.deleteMany({
                where: { propertyId: propertyId }
            });

            // L. Units (Dependent on Property)
            await tx.unit.deleteMany({
                where: { id: { in: unitIds } }
            });

            // M. Property
            await tx.property.delete({
                where: { id: propertyId }
            });
        });

        console.log(`[deleteProperty] Successfully deleted property ${propertyId} and all interactions.`);
        res.json({ message: 'Property and all related data deleted successfully' });

    } catch (error) {
        console.error('Delete Property Error:', error);
        // Specialized error handling if needed, otherwise generic 500
        res.status(500).json({ message: 'Server error during property deletion', error: error.message });
    }
};

exports.getOwners = async (req, res) => {
    try {
        const owners = await prisma.user.findMany({
            where: { role: 'OWNER' },
            include: {
                properties: {
                    include: { units: true }
                },
                company: true
            }
        });

        const formatted = owners.map(o => {
            // Units from directly owned properties
            const directUnits = o.properties.reduce((acc, p) => acc + p.units.length, 0);
            const propertyNames = o.properties.map(p => p.name);

            return {
                id: o.id,
                name: o.name,
                email: o.email,
                phone: o.phone,
                companyId: o.companyId,
                companyName: o.company?.name || o.companyName || '',
                isPrimaryContact: o.company?.primaryContactId === o.id,
                properties: propertyNames,
                totalUnits: directUnits,
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
        const { firstName, lastName, name, email, phone, propertyIds, companyName, companyId, isPrimary } = req.body;
        let { password } = req.body;

        const existing = await prisma.user.findUnique({ where: { email } });
        if (existing) return res.status(400).json({ message: 'Email already exists' });

        // Handle Company Logic
        let targetCompanyId = companyId ? parseInt(companyId) : null;
        if (!targetCompanyId && companyName) {
            const company = await prisma.company.upsert({
                where: { name: companyName },
                update: {},
                create: { name: companyName }
            });
            targetCompanyId = company.id;
        }

        // Auto-generate password if not provided
        if (!password) {
            password = Math.floor(100000 + Math.random() * 900000).toString(); // 6-digit random number
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        const newOwner = await prisma.user.create({
            data: {
                firstName,
                lastName,
                name: name || `${firstName} ${lastName}`,
                email,
                phone,
                companyName,
                companyId: targetCompanyId,
                password: hashedPassword,
                role: 'OWNER',
                properties: {
                    connect: propertyIds?.map(id => ({ id: parseInt(id) })) || []
                }
            }
        });

        // Update Company primary contact if requested or if it's the first user
        if (targetCompanyId) {
            const company = await prisma.company.findUnique({ where: { id: targetCompanyId } });
            if (!company.primaryContactId || isPrimary) {
                await prisma.company.update({
                    where: { id: targetCompanyId },
                    data: { primaryContactId: newOwner.id }
                });
            }

            // Sync Properties to Company
            if (propertyIds?.length > 0) {
                await prisma.property.updateMany({
                    where: { id: { in: propertyIds.map(id => parseInt(id)) } },
                    data: { companyId: targetCompanyId }
                });
            }
        }

        // Manual invite logic only - Removed auto SMS/Email triggers
        res.status(201).json(newOwner);
    } catch (error) {
        console.error('Create Owner Error:', error);
        res.status(500).json({ message: 'Server error' });
    }
};

exports.updateOwner = async (req, res) => {
    try {
        const { id } = req.params;
        const { firstName, lastName, name, email, phone, propertyIds, companyName, companyId, isPrimary } = req.body;

        // Handle Company Logic
        let targetCompanyId = companyId ? parseInt(companyId) : null;
        if (!targetCompanyId && companyName) {
            const company = await prisma.company.upsert({
                where: { name: companyName },
                update: {},
                create: { name: companyName }
            });
            targetCompanyId = company.id;
        }

        const updateData = {
            firstName,
            lastName,
            name: name || `${firstName} ${lastName}`,
            email,
            phone,
            companyName,
            companyId: targetCompanyId,
            properties: {
                set: propertyIds?.map(pid => ({ id: parseInt(pid) })) || []
            }
        };

        const updated = await prisma.user.update({
            where: { id: parseInt(id) },
            data: updateData
        });

        // Update primary contact
        if (targetCompanyId && isPrimary) {
            await prisma.company.update({
                where: { id: targetCompanyId },
                data: { primaryContactId: updated.id }
            });
        }

        // Sync Properties to Company
        if (targetCompanyId && propertyIds?.length > 0) {
            await prisma.property.updateMany({
                where: { id: { in: propertyIds.map(pid => parseInt(pid)) } },
                data: { companyId: targetCompanyId }
            });
        }

        res.json(updated);
    } catch (error) {
        console.error('Update Owner Error:', error);
        res.status(500).json({ message: 'Server error' });
    }
};

exports.deleteOwner = async (req, res) => {
    try {
        const id = parseInt(req.params.id);

        await prisma.$transaction(async (tx) => {
            // 1. Join table entries and property ownership are handled implicitly by many-to-many refactor.
            // But we might want to explicitly disconnect properties if they were linked via ownerId before (handled by migration)
            // No manual join table update needed for implicit rels unless specifically requested.

            // 2. Unlink from company (if primary contact)
            await tx.company.updateMany({
                where: { primaryContactId: id },
                data: { primaryContactId: null }
            });

            // 3. Cleanup User-related dependencies
            await tx.refreshToken.deleteMany({ where: { userId: id } });
            await tx.communicationLog.deleteMany({ where: { recipientId: id } });
            await tx.quickBooksConfig.deleteMany({ where: { userId: id } });
            await tx.message.deleteMany({
                where: {
                    OR: [
                        { senderId: id },
                        { receiverId: id }
                    ]
                }
            });

            // 4. Documents and Insurance (Ownership)
            // Note: Since Insurance refers to Document, delete Insurance first
            await tx.insurance.deleteMany({ where: { userId: id } });
            await tx.document.deleteMany({ where: { userId: id } });

            // 5. Finally delete the user
            await tx.user.delete({
                where: { id: id }
            });
        });

        res.json({ message: 'Owner deleted successfully' });
    } catch (error) {
        console.error('Delete Owner Error:', error);
        res.status(500).json({ message: 'Error deleting owner', error: error.message });
    }
};
exports.sendInvite = async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const { methods } = req.body; // ['email', 'sms']

        if (isNaN(id)) {
            return res.status(400).json({ message: 'Invalid owner ID' });
        }

        const recipientUser = await prisma.user.findUnique({
            where: { id },
            include: { company: true }
        });

        if (!recipientUser) {
            return res.status(404).json({ message: 'Owner not found' });
        }

        // Generate Password if missing
        let plainPassword = null;
        let hashedPassword = null;

        // Always generate a new random password for invites to ensure it's fresh
        plainPassword = Math.floor(100000 + Math.random() * 900000).toString();
        hashedPassword = await bcrypt.hash(plainPassword, 10);

        const inviteToken = crypto.randomBytes(32).toString('hex');
        const inviteExpires = new Date();
        inviteExpires.setDate(inviteExpires.getDate() + 7);

        // Update recipient with new credentials/token
        const updatedUser = await prisma.user.update({
            where: { id: recipientUser.id },
            data: {
                password: hashedPassword,
                inviteToken,
                inviteExpires
            }
        });

        const results = {
            email: { attempted: false, success: false },
            sms: { attempted: false, success: false }
        };

        const loginUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
        const inviteLink = `${loginUrl}/login?token=${inviteToken}`;

        let welcomeMsg = `Welcome to Property Management! \n\nYour login credentials for the portal: \nEmail: ${updatedUser.email}`;
        if (plainPassword) {
            welcomeMsg += ` \nPassword: ${plainPassword}`;
        }
        welcomeMsg += ` \n\nAccess your portal here: ${inviteLink}`;

        if (methods.includes('email')) {
            results.email.attempted = true;
            if (!updatedUser.email) {
                results.email.error = 'No email on file';
            } else {
                try {
                    const eRes = await emailService.sendEmail(updatedUser.email, 'Welcome - Your Owner Portal Access', welcomeMsg);
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
                inviteLink
            }
        });
    } catch (error) {
        console.error('Send Invite Error:', error);
        res.status(500).json({ message: 'Server error while sending invite' });
    }
};

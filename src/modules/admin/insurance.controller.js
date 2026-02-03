const prisma = require('../../config/prisma');
const communicationService = require('../../services/communicationService');

// GET /api/admin/insurance/compliance
exports.getComplianceDashboard = async (req, res) => {
    try {
        const { propertyId, ownerId, status: leaseStatus } = req.query;

        const leaseWhere = {
            status: leaseStatus || 'Active'
        };

        if (propertyId) {
            leaseWhere.unit = { propertyId: parseInt(propertyId) };
        }

        if (ownerId) {
            leaseWhere.unit = {
                property: {
                    owners: {
                        some: { id: parseInt(ownerId) }
                    }
                }
            };
        }

        const leases = await prisma.lease.findMany({
            where: leaseWhere,
            include: {
                tenant: true,
                unit: {
                    include: { property: true }
                },
                insurances: {
                    where: { status: 'ACTIVE' },
                    orderBy: { endDate: 'desc' },
                    take: 1
                }
            }
        });

        const today = new Date();
        const d30 = new Date(); d30.setDate(today.getDate() + 30);
        const d14 = new Date(); d14.setDate(today.getDate() + 14);
        const d7 = new Date(); d7.setDate(today.getDate() + 7);

        const formatted = leases.map(lease => {
            const insurance = lease.insurances[0];
            let complianceStatus = 'Missing';
            let daysRemaining = null;

            if (insurance) {
                const end = new Date(insurance.endDate);
                daysRemaining = Math.ceil((end - today) / (1000 * 60 * 60 * 24));

                if (daysRemaining < 0) {
                    complianceStatus = 'Expired';
                } else if (daysRemaining <= 30) {
                    complianceStatus = 'Expiring';
                } else {
                    complianceStatus = 'Compliant';
                }
            }

            return {
                leaseId: lease.id,
                tenantName: lease.tenant.name,
                tenantType: lease.tenant.type,
                building: lease.unit.property.name,
                unitNumber: lease.unit.unitNumber || lease.unit.name,
                status: complianceStatus,
                daysRemaining,
                provider: insurance?.provider || 'N/A',
                policyNumber: insurance?.policyNumber || 'N/A',
                expiryDate: insurance?.endDate ? insurance.endDate.toISOString().split('T')[0] : 'N/A'
            };
        });

        res.json(formatted);
    } catch (e) {
        console.error('Compliance Dashboard Error:', e);
        res.status(500).json({ message: 'Server error' });
    }
};

// Internal function to check and send alerts
exports.checkInsuranceExpirations = async () => {
    console.log('[Insurance Alerts] Checking for expiring policies...');
    const today = new Date();
    const alertThresholds = [30, 14, 7];

    try {
        const activeInsurances = await prisma.insurance.findMany({
            where: { status: 'ACTIVE', endDate: { gt: today } },
            include: { user: true, lease: true }
        });

        for (const ins of activeInsurances) {
            const end = new Date(ins.endDate);
            const diffDays = Math.ceil((end - today) / (1000 * 60 * 60 * 24));

            if (alertThresholds.includes(diffDays)) {
                // Check if alert already sent for this threshold
                const eventType = `INSURANCE_EXPIRY_${diffDays}`;
                const alreadySent = await prisma.communicationLog.findFirst({
                    where: {
                        recipientId: ins.userId,
                        relatedEntity: 'INSURANCE',
                        entityId: ins.id,
                        eventType
                    }
                });

                if (!alreadySent) {
                    console.log(`Sending ${diffDays}-day alert to ${ins.user.name}`);
                    await communicationService.sendInsuranceExpiryAlert(ins.userId, ins.id, diffDays);
                    // Log the alert
                    await prisma.communicationLog.create({
                        data: {
                            channel: 'Email',
                            eventType,
                            recipient: ins.user.email,
                            recipientId: ins.userId,
                            relatedEntity: 'INSURANCE',
                            entityId: ins.id,
                            content: `Insurance policy ${ins.policyNumber} expires in ${diffDays} days.`
                        }
                    });
                }
            }
        }
    } catch (e) {
        console.error('Check Expirations Error:', e);
    }
};

// GET /api/admin/insurance/alerts
exports.getInsuranceAlerts = async (req, res) => {
    try {
        const { status } = req.query; // Filter by status if provided

        const where = {};
        if (status) {
            where.status = status;
        }

        const insurances = await prisma.insurance.findMany({
            where,
            include: {
                user: true,
                lease: {
                    include: {
                        unit: { include: { property: true } }
                    }
                },
                unit: { include: { property: true } }
            },
            orderBy: { createdAt: 'desc' }
        });

        const getExpiryStatus = (endDate) => {
            const end = new Date(endDate);
            const today = new Date();
            const diffTime = end - today;
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

            if (diffDays < 0) return { label: 'Expired', color: 'red', days: diffDays };
            if (diffDays <= 30) return { label: 'Expiring Soon', color: 'amber', days: diffDays };
            return { label: 'Active', color: 'emerald', days: diffDays };
        };

        const formatted = insurances.map(ins => {
            const unit = ins.unit || ins.lease?.unit;
            const expiry = getExpiryStatus(ins.endDate);

            return {
                id: ins.id,
                tenantName: ins.user.name,
                property: unit ? unit.property.name : 'Unknown',
                unit: unit ? unit.name : 'N/A',
                provider: ins.provider,
                policyNumber: ins.policyNumber,
                startDate: ins.startDate.toISOString().substring(0, 10),
                endDate: ins.endDate.toISOString().substring(0, 10),
                documentUrl: ins.documentUrl,
                status: ins.status,
                rejectionReason: ins.rejectionReason,
                expiry: expiry
            };
        });

        res.json(formatted);
    } catch (e) {
        console.error(e);
        res.status(500).json({ message: 'Server error' });
    }
};

// POST /api/admin/insurance/:id/approve
exports.approveInsurance = async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const insurance = await prisma.insurance.update({
            where: { id },
            data: { status: 'ACTIVE', rejectionReason: null }
        });

        // Trigger notification Logic
        try {
            await communicationService.sendInsuranceApproved(insurance.userId, insurance.id);
        } catch (e) { console.error('Notification failed:', e); }

        res.json({ message: 'Insurance approved successfully', insurance });
    } catch (e) {
        console.error(e);
        res.status(500).json({ message: 'Failed to approve insurance' });
    }
};

// POST /api/admin/insurance/:id/reject
exports.rejectInsurance = async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const { reason } = req.body;

        if (!reason) {
            return res.status(400).json({ message: 'Rejection reason is required' });
        }

        const insurance = await prisma.insurance.update({
            where: { id },
            data: { status: 'REJECTED', rejectionReason: reason }
        });

        // Trigger notification Logic
        try {
            await communicationService.sendInsuranceRejected(insurance.userId, insurance.id, reason);
        } catch (e) { console.error('Notification failed:', e); }

        res.json({ message: 'Insurance rejected successfully', insurance });
    } catch (e) {
        console.error(e);
        res.status(500).json({ message: 'Failed to reject insurance' });
    }
};

// GET /api/admin/insurance/stats
exports.getInsuranceStats = async (req, res) => {
    try {
        const today = new Date();
        const thirtyDaysOut = new Date();
        thirtyDaysOut.setDate(today.getDate() + 30);

        const [active, expiring, expired, pending] = await Promise.all([
            prisma.insurance.count({ where: { status: 'ACTIVE', endDate: { gt: thirtyDaysOut } } }),
            prisma.insurance.count({ where: { status: 'ACTIVE', endDate: { lte: thirtyDaysOut, gte: today } } }),
            prisma.insurance.count({ where: { status: 'ACTIVE', endDate: { lt: today } } }),
            prisma.insurance.count({ where: { status: 'PENDING_APPROVAL' } })
        ]);

        res.json({
            active,
            expiring,
            expired,
            pending
        });
    } catch (e) {
        console.error(e);
        res.status(500).json({ message: 'Failed to fetch insurance stats' });
    }
};

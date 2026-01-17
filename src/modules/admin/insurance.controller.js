const prisma = require('../../config/prisma');
const communicationService = require('../../services/communicationService');

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

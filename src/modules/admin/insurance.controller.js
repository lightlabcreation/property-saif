const prisma = require('../../config/prisma');

// GET /api/admin/insurance/alerts
exports.getInsuranceAlerts = async (req, res) => {
    try {
        const today = new Date();
        const insurances = await prisma.insurance.findMany({
            include: {
                user: true
            }
        });

        // Fallback for older records without unitId
        const activeLeases = await prisma.lease.findMany({
            where: { status: 'Active' },
            include: {
                unit: {
                    include: { property: true }
                }
            }
        });

        const userLeaseMap = {};
        activeLeases.forEach(l => {
            userLeaseMap[l.tenantId] = l.unit;
        });

        const getPolicyStatus = (endDate) => {
            const end = new Date(endDate);
            const today = new Date();
            const diffTime = end - today;
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

            if (diffDays < 0) return { label: 'Expired', color: 'red', days: diffDays };
            if (diffDays <= 30) return { label: 'Expiring Soon', color: 'amber', days: diffDays };
            return { label: 'Active', color: 'emerald', days: diffDays };
        };

        const formatted = insurances.map(ins => {
            const unit = ins.unit || userLeaseMap[ins.userId];
            const status = getPolicyStatus(ins.endDate);

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
                status: status
            };
        });

        res.json(formatted);
    } catch (e) {
        console.error(e);
        res.status(500).json({ message: 'Server error' });
    }
};

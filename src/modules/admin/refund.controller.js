const prisma = require('../../config/prisma');

// GET /api/admin/refunds
exports.getRefunds = async (req, res) => {
    try {
        const refunds = await prisma.refundAdjustment.findMany({
            include: {
                tenant: true,
                unit: true
            },
            orderBy: {
                date: 'desc'
            }
        });

        const formatted = refunds.map(r => ({
            id: r.requestId,
            type: r.type,
            reason: r.reason,
            tenant: r.tenant.name,
            unit: r.unit.name,
            amount: parseFloat(r.amount),
            date: r.date.toLocaleDateString('en-GB', {
                day: '2-digit', month: 'short', year: 'numeric'
            }),
            status: r.status
        }));

        res.json(formatted);
    } catch (e) {
        console.error(e);
        res.status(500).json({ message: 'Server error' });
    }
};

// POST /api/admin/refunds (For seeding/creating via API tools)
exports.createRefund = async (req, res) => {
    try {
        const { type, reason, tenantId, unitId, amount, status, date } = req.body;

        const count = await prisma.refundAdjustment.count();
        const requestId = `RA-${String(count + 1).padStart(3, '0')}`;

        const newRefund = await prisma.refundAdjustment.create({
            data: {
                requestId,
                type,
                reason,
                tenantId: parseInt(tenantId),
                unitId: parseInt(unitId),
                amount: parseFloat(amount),
                status: status || 'Pending',
                date: date ? new Date(date) : new Date()
            }
        });

        res.status(201).json(newRefund);
    } catch (e) {
        console.error(e);
        res.status(500).json({ message: 'Error creating refund' });
    }
};

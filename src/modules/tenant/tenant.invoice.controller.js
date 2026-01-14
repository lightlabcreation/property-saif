const prisma = require('../../config/prisma');

// GET /api/tenant/invoices
exports.getInvoices = async (req, res) => {
    try {
        const userId = req.user.id;

        // Find invoices where tenantId matches
        // User Requirement: "status != PAID" explicitly
        const invoices = await prisma.invoice.findMany({
            where: {
                tenantId: userId,
                status: {
                    notIn: ['draft']
                }
            },
            orderBy: { createdAt: 'desc' },
            include: { unit: true }
        });

        const formatted = invoices.map(inv => {
            let statusDisplay = 'Due';
            const s = inv.status.toLowerCase();

            if (s === 'paid') statusDisplay = 'Paid';
            else if (s === 'overdue') statusDisplay = 'Overdue';
            else if (s === 'sent') statusDisplay = 'Due';
            else if (s === 'unpaid') statusDisplay = 'Due'; // Map Unpaid -> Due for Frontend
            else statusDisplay = s.charAt(0).toUpperCase() + s.slice(1);

            return {
                id: inv.invoiceNo,
                dbId: inv.id,
                month: inv.month,
                amount: parseFloat(inv.amount),
                rent: parseFloat(inv.rent),
                serviceFees: parseFloat(inv.serviceFees),
                status: statusDisplay,
                date: inv.createdAt.toISOString().split('T')[0],
                unit: inv.unit ? inv.unit.name : 'N/A'
            };
        });

        res.json(formatted);
    } catch (e) {
        console.error(e);
        res.status(500).json({ message: 'Server error' });
    }
};

const prisma = require('../../config/prisma');

// GET /api/owner/financials
exports.getFinancialStats = async (req, res) => {
    try {
        const ownerId = req.user.id;

        // Mocked real logic: Sum of rent from owned properties properties
        // 1. Get properties
        const properties = await prisma.property.findMany({
            where: { ownerId },
            include: { units: { include: { leases: true } } }
        });

        let totalRevenue = 0;
        let pendingDues = 0; // Mock calculation

        // Calculate theoretical revenue based on active leases
        // In reality, this should come from a Payment/Invoice table
        properties.forEach(p => {
            p.units.forEach(u => {
                u.leases.forEach(l => {
                    if (l.status === 'Active') {
                        totalRevenue += parseFloat(l.monthlyRent);
                    }
                });
            });
        });

        // Mock recent transactions since we don't have Payment Table yet
        // In Phase 3 (Tenant) or Phase 4, we would add Payment Model
        const recentTransactions = [
            { id: 'TXN-REAL-1', property: properties[0]?.name || 'Prop A', date: '2026-01-10', amount: 12000, type: 'Rent', status: 'Paid' },
            { id: 'TXN-REAL-2', property: properties[0]?.name || 'Prop A', date: '2026-01-05', amount: 500, type: 'Fee', status: 'Paid' }
        ];

        res.json({
            collected: totalRevenue, // Mocking "Collected" as "Total Potential" for now
            transactions: recentTransactions
        });

    } catch (e) {
        console.error(e);
        res.status(500).json({ message: 'Server error' });
    }
};

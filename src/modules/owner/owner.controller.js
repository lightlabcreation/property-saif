const prisma = require('../../config/prisma');

// GET /api/owner/dashboard/stats
exports.getOwnerDashboardStats = async (req, res) => {
    try {
        const ownerId = req.user.id;
        const user = await prisma.user.findUnique({ where: { id: ownerId } });
        const companyId = user.companyId;

        // 1. Get all properties for this owner OR their company
        const properties = await prisma.property.findMany({
            where: {
                OR: [
                    { ownerId },
                    { companyId: companyId || -1 }
                ]
            },
            include: { units: true }
        });
        const propertyIds = properties.map(p => p.id);
        const propertyCount = properties.length;

        // 2. Units in those properties
        const unitCount = await prisma.unit.count({ where: { propertyId: { in: propertyIds } } });

        // 3. Occupancy
        const occupiedCount = await prisma.unit.count({
            where: {
                propertyId: { in: propertyIds },
                status: 'Occupied'
            }
        });
        const vacantCount = unitCount - occupiedCount;

        // 4. Revenue (Simple Sum)
        const revenueAgg = await prisma.unit.aggregate({
            where: {
                propertyId: { in: propertyIds },
                status: 'Occupied'
            },
            _sum: { rentAmount: true }
        });
        const monthlyRevenue = revenueAgg._sum.rentAmount || 0;

        // 5. Outstanding Dues
        const duesAgg = await prisma.invoice.aggregate({
            where: {
                unit: { propertyId: { in: propertyIds } },
                status: { not: 'paid' }
            },
            _sum: { amount: true }
        });
        const outstandingDues = duesAgg._sum.amount || 0;


        // 6. Insurance Expiry (Next 30 days)
        const thirtyDaysFromNow = new Date();
        thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);

        const insuranceExpiryCount = await prisma.insurance.count({
            where: {
                OR: [
                    { userId: ownerId },
                    { unit: { propertyId: { in: propertyIds } } }
                ],
                endDate: {
                    gte: new Date(),
                    lte: thirtyDaysFromNow
                }
            }
        });

        res.json({
            propertyCount,
            unitCount,
            occupancy: { occupied: occupiedCount, vacant: vacantCount },
            monthlyRevenue: parseFloat(monthlyRevenue),
            outstandingDues: parseFloat(outstandingDues),
            insuranceExpiryCount,
            recentActivity: ["Rent payment received", "Maintenance request resolved"]
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
};

// GET /api/owner/properties
exports.getOwnerProperties = async (req, res) => {
    try {
        const ownerId = req.user.id;
        const user = await prisma.user.findUnique({ where: { id: ownerId } });
        const properties = await prisma.property.findMany({
            where: {
                OR: [
                    { ownerId },
                    { companyId: user.companyId || -1 }
                ]
            },
            include: { units: true }
        });

        const formatted = properties.map(p => {
            const totalUnits = p.units.length;
            const occupiedCount = p.units.filter(u => u.status === 'Occupied').length;
            const occupancyRate = totalUnits > 0 ? Math.round((occupiedCount / totalUnits) * 100) : 0;
            return {
                id: p.id,
                name: p.name,
                address: p.address,
                units: totalUnits,
                occupancy: `${occupancyRate}%`,
                status: p.status
            };
        });

        res.json(formatted);
    } catch (error) {
        res.status(500).json({ message: 'Error' });
    }
};

// GET /api/owner/financials
exports.getOwnerFinancials = async (req, res) => {
    try {
        const ownerId = req.user.id;
        const user = await prisma.user.findUnique({ where: { id: ownerId } });

        // Find properties for this owner OR company
        const properties = await prisma.property.findMany({
            where: {
                OR: [
                    { ownerId },
                    { companyId: user.companyId || -1 }
                ]
            }
        });
        const propertyIds = properties.map(p => p.id);

        // Find paid invoices (Revenue)
        const invoices = await prisma.invoice.findMany({
            where: {
                unit: { propertyId: { in: propertyIds } },
                status: 'paid'
            },
            include: { unit: { include: { property: true } } },
            orderBy: { paidAt: 'desc' },
            take: 50
        });

        const totalCollected = invoices.reduce((sum, inv) => sum + parseFloat(inv.amount), 0);

        const transactions = invoices.map(inv => ({
            id: `INV-${inv.id}`,
            property: inv.unit.property.name,
            date: inv.paidAt ? inv.paidAt.toLocaleDateString() : inv.createdAt.toLocaleDateString(),
            type: 'Rent Payment',
            amount: parseFloat(inv.amount),
            status: 'Paid'
        }));

        res.json({
            collected: totalCollected,
            transactions
        });

    } catch (e) {
        console.error(e);
        res.status(500).json({ message: 'Server error' });
    }
};


// GET /api/owner/dashboard/financial-pulse
exports.getOwnerFinancialPulse = async (req, res) => {
    try {
        const ownerId = req.user.id;
        const user = await prisma.user.findUnique({ where: { id: ownerId } });

        // Get properties for this owner OR company
        const properties = await prisma.property.findMany({
            where: {
                OR: [
                    { ownerId },
                    { companyId: user.companyId || -1 }
                ]
            }
        });
        const propertyIds = properties.map(p => p.id);

        const financialPulse = [];
        const today = new Date();

        for (let i = 0; i < 6; i++) {
            const date = new Date(today.getFullYear(), today.getMonth() - i, 1);
            const monthStr = date.toLocaleString('default', { month: 'short', year: 'numeric' });

            const monthStart = new Date(date.getFullYear(), date.getMonth(), 1);
            const monthEnd = new Date(date.getFullYear(), date.getMonth() + 1, 0);

            const monthlyInvoices = await prisma.invoice.findMany({
                where: {
                    unit: { propertyId: { in: propertyIds } },
                    createdAt: {
                        gte: monthStart,
                        lte: monthEnd
                    }
                }
            });

            let expected = 0;
            let collected = 0;
            let dues = 0;

            monthlyInvoices.forEach(inv => {
                const amount = parseFloat(inv.amount);
                expected += amount;
                if (inv.status === 'paid') {
                    collected += amount;
                } else {
                    dues += amount;
                }
            });

            financialPulse.push({
                month: monthStr,
                expected,
                collected,
                dues
            });
        }

        res.json(financialPulse);

    } catch (e) {
        console.error(e);
        res.status(500).json({ message: 'Server error' });
    }
};

// GET /api/owner/reports – dynamic reports list and stats for owner's portfolio
exports.getOwnerReports = async (req, res) => {
    try {
        const ownerId = req.user.id;
        const user = await prisma.user.findUnique({ where: { id: ownerId } });
        const propertyIds = (await prisma.property.findMany({
            where: {
                OR: [
                    { ownerId },
                    { companyId: user?.companyId ?? -1 }
                ]
            },
            select: { id: true }
        })).map(p => p.id);

        const today = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        const lastMonth = new Date();
        lastMonth.setMonth(lastMonth.getMonth() - 1);
        const lastMonthStr = lastMonth.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

        let reportsViewable = 4;
        if (propertyIds.length > 0) {
            const twelveMonthsAgo = new Date();
            twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);
            const invoiceCount = await prisma.invoice.count({
                where: { unit: { propertyId: { in: propertyIds } }, createdAt: { gte: twelveMonthsAgo } }
            });
            reportsViewable = Math.min(99, Math.max(4, Math.ceil(invoiceCount / 3) || 4));
        }

        const reports = [
            { id: 'monthly_summary', title: 'Monthly Performance Summary', description: 'Comprehensive view of revenue, occupancy, and expenses for the current month.', type: 'monthly_summary', lastGenerated: today },
            { id: 'annual_overview', title: 'Annual Financial Overview', description: 'Year-on-year growth, cumulative earnings, and portfolio valuation trends.', type: 'annual_overview', lastGenerated: today },
            { id: 'occupancy_stats', title: 'Occupancy & Vacancy Analysis', description: 'Unit-by-unit occupancy status and historical vacancy rates across all sites.', type: 'occupancy_stats', lastGenerated: today },
            { id: 'tax_statement', title: 'Tax Compliance Statement', description: 'Read-only tax summaries and deductible expense records for audit purposes.', type: 'tax_statement', lastGenerated: lastMonthStr },
        ];

        res.json({
            reports,
            stats: {
                reportsViewable: `${reportsViewable} Total`,
                reportsViewableSub: 'Last 12 months',
                exportLimit: 'Unlimited',
                exportLimitSub: 'PDF / CSV Formats',
                dataLatency: 'Real-time',
                dataLatencySub: 'Synced with Admin'
            }
        });
    } catch (e) {
        console.error(e);
        res.status(500).json({ message: 'Server error' });
    }
};

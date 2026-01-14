const prisma = require('../../config/prisma');

// GET /api/owner/dashboard/stats
exports.getOwnerDashboardStats = async (req, res) => {
    try {
        const ownerId = req.user.id; // From Auth Middleware

        // 1. Properties Owned
        const propertyCount = await prisma.property.count({ where: { ownerId } });

        // 2. Units in those properties
        const properties = await prisma.property.findMany({
            where: { ownerId },
            include: { units: true }
        });
        const propertyIds = properties.map(p => p.id);
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
        // Sum of all unpaid invoices for these properties
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
                userId: ownerId,
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
            recentActivity: ["Rent payment received", "Maintenance request resolved"] // Placeholder for now
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
        const properties = await prisma.property.findMany({
            where: { ownerId },
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

        // Find properties for this owner
        const properties = await prisma.property.findMany({ where: { ownerId }, include: { units: true } });
        const propertyIds = properties.map(p => p.id);

        // Find paid invoices (Revenue)
        // Accessing invoices via Unit -> Property
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

        // Get properties for this owner
        const properties = await prisma.property.findMany({ where: { ownerId }, include: { units: true } });
        const propertyIds = properties.map(p => p.id);

        // We want the last 6 months of data
        const financialPulse = [];
        const today = new Date();

        for (let i = 0; i < 6; i++) {
            const date = new Date(today.getFullYear(), today.getMonth() - i, 1);
            const monthStr = date.toLocaleString('default', { month: 'short', year: 'numeric' });

            // Expected Revenue (Target) - Sum of rent of all currently occupied units (Approximation)
            // In a real system, this should come from generated invoices for that month
            const monthStart = new Date(date.getFullYear(), date.getMonth(), 1);
            const monthEnd = new Date(date.getFullYear(), date.getMonth() + 1, 0);

            // Fetch Invoices for this month
            const invoices = await prisma.invoice.findMany({
                where: {
                    unit: { propertyId: { in: propertyIds } },
                    month: monthStr // Assuming 'month' field stores "Jan 2026" etc. Or we filter by createdAt
                    // Better approach if 'month' is not consistent: Filter by createdAt range
                    // createdAt: { gte: monthStart, lte: monthEnd }
                }
            });

            // Calculate Metrics
            let expected = 0;
            let collected = 0;
            let dues = 0;

            // If using 'month' string field in Invoice model as strictly "Month Year":
            // We need to match the format stored in DB. Let's assume the DB stores "Jan 2026".
            // If the DB usage of 'month' is inconsistent, we might need to rely on dates.
            // For this implementation, let's aggregate based on the fetched invoices which we'll try to filter by date first if 'month' is unreliable,
            // but looking at the schema, 'month' is a String. Let's try to match it.
            // A safer bet for now without standardized month strings is to assume invoices created in that month belong to that month.

            // Re-fetching with date range for accuracy
            const monthlyInvoices = await prisma.invoice.findMany({
                where: {
                    unit: { propertyId: { in: propertyIds } },
                    createdAt: {
                        gte: monthStart,
                        lte: monthEnd
                    }
                }
            });

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

// GET /api/owner/reports
exports.getOwnerReports = async (req, res) => {
    // Return definition of available reports with dynamic dates
    const today = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    const lastMonth = new Date();
    lastMonth.setMonth(lastMonth.getMonth() - 1);
    const lastMonthStr = lastMonth.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

    const reports = [
        {
            title: 'Monthly Performance Summary',
            description: 'Comprehensive view of revenue, occupancy, and expenses for the current month.',
            type: 'monthly_summary',
            lastGenerated: today
        },
        {
            title: 'Annual Financial Overview',
            description: 'Year-on-year growth, cumulative earnings, and portfolio valuation trends.',
            type: 'annual_overview',
            lastGenerated: today
        },
        {
            title: 'Occupancy & Vacancy Analysis',
            description: 'Unit-by-unit occupancy status and historical vacancy rates across all sites.',
            type: 'occupancy_stats',
            lastGenerated: today
        },
        {
            title: 'Tax Compliance Statement',
            description: 'Read-only tax summaries and deductible expense records for audit purposes.',
            type: 'tax_statement',
            lastGenerated: lastMonthStr
        },
    ];
    res.json(reports);
};

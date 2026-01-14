const prisma = require('../../config/prisma');
const { generateReportPDF } = require('../../utils/pdf.utils');

// GET /api/admin/reports/:id/download
exports.downloadReportPDF = async (req, res) => {
    try {
        const { id } = req.params;
        // Basic implementation, can be expanded to fetch real data
        generateReportPDF(id, res);
    } catch (e) {
        console.error(e);
        res.status(500).json({ message: 'Error generating PDF' });
    }
};

// GET /api/admin/reports
exports.getReports = async (req, res) => {
    try {
        // --- KPI Calculation ---

        // Total Revenue (Paid Invoices)
        const paidInvoices = await prisma.invoice.findMany({ where: { status: 'paid' } });
        const totalRevenue = paidInvoices.reduce((sum, i) => sum + parseFloat(i.amount), 0);

        // Occupancy Rate
        const totalUnits = await prisma.unit.count();
        const occupiedUnits = await prisma.unit.count({ where: { status: { not: 'Vacant' } } });
        const occupancyRate = totalUnits > 0 ? Math.round((occupiedUnits / totalUnits) * 100) : 0;

        // Active Leases
        const activeLeases = await prisma.lease.count({ where: { status: 'Active' } });

        // Outstanding Dues (Invoices not paid)
        const unpaidInvoices = await prisma.invoice.findMany({ where: { status: 'sent' } }); // Assuming 'sent' means pending
        const outstandingDues = unpaidInvoices.reduce((sum, i) => sum + parseFloat(i.amount), 0);


        // --- Graphs Data ---

        // Monthly Revenue (Aggregate by month string)
        const monthlyMap = {};
        paidInvoices.forEach(inv => {
            if (!monthlyMap[inv.month]) monthlyMap[inv.month] = 0;
            monthlyMap[inv.month] += parseFloat(inv.amount);
        });

        // Lease Type Distribution
        // We need to fetch units to check bedrooms count for lease type heuristic
        const leases = await prisma.lease.findMany({
            where: { status: 'Active' },
            include: { unit: true }
        });

        let fullUnitCount = 0;
        let bedroomCount = 0;
        leases.forEach(l => {
            if (l.unit.rentalMode === 'FULL_UNIT') fullUnitCount++;
            else bedroomCount++;
        });

        // --- Top Performing Properties ---
        const properties = await prisma.property.findMany({
            include: {
                units: {
                    include: {
                        leases: { where: { status: 'Active' } },
                        invoices: { where: { status: 'paid' } }
                    }
                }
            }
        });

        const propertyPerformance = properties.map(p => {
            const revenue = p.units.reduce((rSum, u) => {
                return rSum + u.invoices.reduce((iSum, i) => iSum + parseFloat(i.amount), 0);
            }, 0);
            const pTotalUnits = p.units.length;
            const pOccupied = p.units.filter(u => u.status !== 'Vacant').length;
            const pOccupancy = pTotalUnits > 0 ? Math.round((pOccupied / pTotalUnits) * 100) : 0;

            return {
                name: p.name,
                revenue,
                occupancy: pOccupancy
            };
        }).sort((a, b) => b.revenue - a.revenue).slice(0, 5); // Top 5

        res.json({
            kpi: {
                totalRevenue,
                occupancyRate,
                activeLeases,
                outstandingDues
            },
            monthlyRevenue: Object.keys(monthlyMap).map(k => ({ month: k, amount: monthlyMap[k] })),
            leaseDistribution: { fullUnit: fullUnitCount, bedroom: bedroomCount },
            topProperties: propertyPerformance
        });

    } catch (e) {
        console.error(e);
        res.status(500).json({ message: 'Server error' });
    }
};

const prisma = require('../../config/prisma');

exports.getRevenueStats = async (req, res) => {
    try {
        // 1. Actual Revenue (Requirement 7): Sum of paidAmount across all invoices
        const invoiceAgg = await prisma.invoice.aggregate({
            _sum: { paidAmount: true }
        });
        const actualRevenue = parseFloat(invoiceAgg._sum.paidAmount) || 0;

        // 2. Projected Revenue (Requirement 7): Sum of monthlyRent across all Active leases
        const leaseAgg = await prisma.lease.aggregate({
            where: { status: 'Active' },
            _sum: { monthlyRent: true }
        });
        const projectedRevenue = parseFloat(leaseAgg._sum.monthlyRent) || 0;

        // 3. Breakdown by Property (Actual Revenue Focused)
        const invoices = await prisma.invoice.findMany({
            where: { paidAmount: { gt: 0 } },
            include: { unit: { include: { property: true } } }
        });

        const propertyMap = {};
        invoices.forEach(inv => {
            const propName = inv.unit?.property?.name || 'Other Building';
            if (!propertyMap[propName]) propertyMap[propName] = 0;
            propertyMap[propName] += parseFloat(inv.paidAmount);
        });
        const revenueByProperty = Object.keys(propertyMap).map(p => ({
            name: p,
            amount: propertyMap[p]
        }));

        // 4. Monthly Breakdown (Actual Revenue Focused)
        const monthlyMap = {};
        invoices.forEach(inv => {
            if (!monthlyMap[inv.month]) monthlyMap[inv.month] = 0;
            monthlyMap[inv.month] += parseFloat(inv.paidAmount);
        });
        const monthlyRevenue = Object.keys(monthlyMap).map(m => ({
            month: m,
            amount: monthlyMap[m]
        }));

        res.json({
            actualRevenue,
            projectedRevenue,
            totalRevenue: actualRevenue, // Backward compatibility
            monthlyRevenue,
            revenueByProperty
        });
    } catch (e) {
        console.error(e);
        res.status(500).json({ message: 'Server error' });
    }
};

exports.getVacancyStats = async (req, res) => {
    try {
        const units = await prisma.unit.findMany({
            include: { property: true }
        });

        const total = units.length;
        const vacant = units.filter(u => u.status === 'Vacant').length;
        const occupied = total - vacant;

        // By Building
        const buildingStats = {};
        units.forEach(u => {
            const propName = u.property?.name || 'Other';
            if (!buildingStats[propName]) buildingStats[propName] = { total: 0, vacant: 0 };
            buildingStats[propName].total++;
            if (u.status === 'Vacant') buildingStats[propName].vacant++;
        });

        const vacancyByBuilding = Object.keys(buildingStats).map(p => ({
            name: p,
            vacant: buildingStats[p].vacant,
            total: buildingStats[p].total
        }));

        res.json({
            total,
            vacant,
            occupied,
            vacancyByBuilding
        });
    } catch (e) {
        console.error(e);
        res.status(500).json({ message: 'Server error' });
    }
};

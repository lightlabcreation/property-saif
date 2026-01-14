const prisma = require('../../config/prisma');

exports.getRevenueStats = async (req, res) => {
    try {
        // Aggregate all PAID invoices
        const allInvoices = await prisma.invoice.findMany({
            where: { status: 'paid' },
            include: { unit: { include: { property: true } } } // Needed for breakdown
        });

        // 1. Total Revenue
        const totalRevenue = allInvoices.reduce((sum, inv) => sum + parseFloat(inv.amount), 0);

        // 2. Monthly Revenue (Mocking specific months logic for brevity, but grouping by month string)
        const monthlyMap = {};
        allInvoices.forEach(inv => {
            if (!monthlyMap[inv.month]) monthlyMap[inv.month] = 0;
            monthlyMap[inv.month] += parseFloat(inv.amount);
        });
        const monthlyRevenue = Object.keys(monthlyMap).map(m => ({ month: m, amount: monthlyMap[m] }));

        // 3. By Property
        const propertyMap = {};
        allInvoices.forEach(inv => {
            const propName = inv.unit?.property?.name || 'Other';
            if (!propertyMap[propName]) propertyMap[propName] = 0;
            propertyMap[propName] += parseFloat(inv.amount);
        });
        const revenueByProperty = Object.keys(propertyMap).map(p => ({ name: p, amount: propertyMap[p] }));

        res.json({
            totalRevenue,
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

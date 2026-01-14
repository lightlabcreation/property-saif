const prisma = require('../../config/prisma');

// GET /api/tenant/dashboard
exports.getDashboard = async (req, res) => {
    try {
        const userId = req.user.id;

        // 1. Get Tenant details with active lease
        const tenant = await prisma.user.findUnique({
            where: { id: userId },
            include: {
                leases: {
                    where: { status: 'Active' },
                    include: { unit: true }
                },
                insurances: true
            }
        });

        if (!tenant) return res.status(404).json({ message: 'Tenant not found' });

        const activeLease = tenant.leases[0];

        // 2. Real calculation for Dashboard

        // Open Tickets Count
        const openTickets = await prisma.ticket.count({
            where: {
                userId,
                status: { not: 'Resolved' }
            }
        });

        // Rent Due Status
        let rentDueStatus = 'No Dues';
        let currentRent = 0;

        if (activeLease) {
            currentRent = parseFloat(activeLease.monthlyRent);

            // Find latest unpaid invoice
            const latestInvoice = await prisma.invoice.findFirst({
                where: {
                    tenantId: userId,
                    status: { not: 'paid' }
                },
                orderBy: { createdAt: 'desc' }
            });

            if (latestInvoice) {
                // Parse "Month Year" or use createdAt
                // Assuming simple logic for now: if unpaid, it is due.
                // We can check if it's overdue or due soon.
                // For simplicity: "Due Now"
                rentDueStatus = `Due: ${latestInvoice.amount}`;
            } else {
                rentDueStatus = 'All Paid';
            }
        }

        const stats = {
            currentRent,
            rentDueStatus,
            leaseStatus: activeLease ? 'Active' : 'No Active Lease',
            leaseExpiry: activeLease ? activeLease.endDate : null,
            insuranceStatus: tenant.insurances.length > 0 ? 'Compliant' : 'Missing',
            openTickets: `${openTickets} Open`
        };

        res.json({
            tenantName: tenant.name,
            stats
        });

    } catch (e) {
        console.error(e);
        res.status(500).json({ message: 'Server error' });
    }
};

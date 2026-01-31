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

// GET /api/tenant/reports – dynamic stats and report definitions for tenant
exports.getReports = async (req, res) => {
    try {
        const userId = req.user.id;

        const invoices = await prisma.invoice.findMany({
            where: { tenantId: userId, status: { not: 'draft' } },
            orderBy: { createdAt: 'desc' }
        });

        const paidInvoices = invoices.filter(i => (i.status || '').toLowerCase() === 'paid');
        const paidAmount = paidInvoices.reduce((sum, i) => sum + parseFloat(i.amount || 0), 0);
        const outstandingInvoices = invoices.filter(i => (i.status || '').toLowerCase() !== 'paid');
        const outstandingAmount = outstandingInvoices.reduce((sum, i) => sum + parseFloat(i.amount || 0), 0);

        const twelveMonthsAgo = new Date();
        twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);
        const last12Count = invoices.filter(i => new Date(i.createdAt) >= twelveMonthsAgo).length;

        const today = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        const lastPaidAt = paidInvoices[0]?.paidAt ? new Date(paidInvoices[0].paidAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : today;

        const reports = [
            { id: 'payment_history', title: 'Payment History', description: 'All rent and fee payments for your tenancy.', type: 'payment_history', lastGenerated: lastPaidAt },
            { id: 'invoice_summary', title: 'Invoice Summary', description: 'Invoices issued and payment status by month.', type: 'invoice_summary', lastGenerated: today },
        ];

        res.json({
            reports,
            stats: {
                totalInvoices: invoices.length,
                paidCount: paidInvoices.length,
                paidAmount: Math.round(paidAmount * 100) / 100,
                outstandingAmount: Math.round(outstandingAmount * 100) / 100,
                last12MonthsCount: last12Count,
                reportsViewable: `${reports.length} Available`,
                reportsViewableSub: 'Your account',
                exportLimit: 'Unlimited',
                exportLimitSub: 'PDF format',
                dataLatency: 'Real-time',
                dataLatencySub: 'Synced with property'
            }
        });
    } catch (e) {
        console.error(e);
        res.status(500).json({ message: 'Server error' });
    }
};

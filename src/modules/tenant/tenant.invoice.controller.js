const prisma = require('../../config/prisma');
const { generateInvoicePDF } = require('../../utils/pdf.utils');

// GET /api/tenant/invoices
exports.getInvoices = async (req, res) => {
    try {
        const userId = req.user.id;

        // Find invoices where tenantId matches
        const invoices = await prisma.invoice.findMany({
            where: {
                tenantId: userId,
                status: {
                    not: 'draft' // Show everything that isn't a draft
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
            else if (s === 'unpaid') statusDisplay = 'Due';
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

// GET /api/tenant/invoices/:id/download
exports.downloadInvoicePDF = async (req, res) => {
    try {
        const userId = req.user.id;
        const id = parseInt(req.params.id);

        const invoice = await prisma.invoice.findFirst({
            where: { id, tenantId: userId },
            include: {
                tenant: true,
                unit: true
            }
        });

        if (!invoice) return res.status(404).json({ message: 'Invoice not found' });

        generateInvoicePDF(invoice, res);
    } catch (e) {
        console.error(e);
        res.status(500).json({ message: 'Error generating PDF' });
    }
};

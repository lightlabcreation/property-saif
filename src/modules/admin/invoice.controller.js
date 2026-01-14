const prisma = require('../../config/prisma');
const { generateInvoicePDF } = require('../../utils/pdf.utils');

// GET /api/admin/invoices/:id/download
exports.downloadInvoicePDF = async (req, res) => {
    try {
        const invoice = await prisma.invoice.findUnique({
            where: { id: parseInt(req.params.id) },
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

// GET /api/admin/invoices
exports.getInvoices = async (req, res) => {
    try {
        const invoices = await prisma.invoice.findMany({
            include: {
                tenant: {
                    include: { leases: true }
                },
                unit: true
            },
            orderBy: { createdAt: 'desc' }
        });

        const formatted = invoices.map(inv => {
            // Find active lease to get dates
            const activeLease = inv.tenant.leases.find(l => l.status === 'Active' || l.status === 'DRAFT');

            return {
                id: inv.id,
                invoiceNo: inv.invoiceNo,
                tenantId: inv.tenantId,
                unitId: inv.unitId,
                tenant: inv.tenant.name,
                unit: inv.unit.name,
                month: inv.month,
                rent: parseFloat(inv.rent),
                serviceFees: parseFloat(inv.serviceFees),
                amount: parseFloat(inv.amount),
                status: inv.status,
                leaseStartDate: activeLease?.startDate || null,
                leaseEndDate: activeLease?.endDate || null
            };
        });

        res.json(formatted);
    } catch (e) {
        console.error(e);
        res.status(500).json({ message: 'Server error' });
    }
};

// POST /api/admin/invoices (Create draft)
exports.createInvoice = async (req, res) => {
    try {
        const { tenantId, unitId, month, rent, serviceFees } = req.body;

        if (!tenantId || !unitId) {
            return res.status(400).json({ message: 'Tenant ID and Unit ID are required' });
        }

        // Generate Invoice Number
        const count = await prisma.invoice.count();
        const invoiceNo = `INV-MAN-${String(count + 1).padStart(5, '0')}`;

        const rentAmt = parseFloat(rent) || 0;
        const feesAmt = parseFloat(serviceFees) || 0;
        const totalAmount = rentAmt + feesAmt;

        const newInvoice = await prisma.invoice.create({
            data: {
                invoiceNo,
                tenantId: parseInt(tenantId),
                unitId: parseInt(unitId),
                month,
                rent: rentAmt,
                serviceFees: feesAmt,
                amount: totalAmount,
                paidAmount: 0,
                balanceDue: totalAmount,
                status: 'draft'
            },
            include: {
                tenant: true,
                unit: true
            }
        });

        res.status(201).json(newInvoice);

    } catch (e) {
        console.error(e);
        res.status(500).json({ message: 'Error creating invoice' });
    }
};

// PUT /api/admin/invoices/:id (Update status or details)
exports.updateInvoice = async (req, res) => {
    try {
        const { status, month, rent, serviceFees, paymentMethod } = req.body;
        const id = parseInt(req.params.id);

        const existing = await prisma.invoice.findUnique({ where: { id } });
        if (!existing) return res.status(404).json({ message: 'Invoice not found' });

        const data = {};
        if (month) data.month = month;

        let newRent = rent !== undefined ? parseFloat(rent) : Number(existing.rent);
        let newFees = serviceFees !== undefined ? parseFloat(serviceFees) : Number(existing.serviceFees);

        if (status) {
            data.status = status;
            if (status.toLowerCase() === 'paid') {
                data.paidAt = new Date();
                data.paidAmount = existing.amount;
                data.balanceDue = 0;
                if (paymentMethod) data.paymentMethod = paymentMethod;

                // CRITICAL (Requirement 2): If manual status change to Paid, we should ideally create a transaction
                // but usually this is done via the Payment process. If it's done manually here, 
                // we should still record it in the ledger for consistency.
                await prisma.transaction.create({
                    data: {
                        date: new Date(),
                        description: `Manual Invoice Paid - ${existing.invoiceNo}`,
                        type: 'Income',
                        amount: existing.amount,
                        status: 'Completed',
                        invoiceId: id
                    }
                });
            }
        }

        if (rent !== undefined || serviceFees !== undefined) {
            data.rent = newRent;
            data.serviceFees = newFees;
            data.amount = newRent + newFees;
            // Recalc balance based on what was already paid
            data.balanceDue = (newRent + newFees) - Number(existing.paidAmount);
        }

        const updated = await prisma.invoice.update({
            where: { id },
            data
        });
        res.json(updated);
    } catch (e) {
        console.error(e);
        res.status(500).json({ message: 'Error updating invoice' });
    }
};

// DELETE /api/admin/invoices/:id
exports.deleteInvoice = async (req, res) => {
    try {
        await prisma.invoice.delete({ where: { id: parseInt(req.params.id) } });
        res.json({ message: 'Deleted' });
    } catch (e) {
        res.status(500).json({ message: 'Error deleting' });
    }
};

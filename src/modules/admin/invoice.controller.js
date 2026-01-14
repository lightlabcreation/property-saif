const prisma = require('../../config/prisma');

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
            return res.status(400).json({ message: 'Tenant and Unit are required' });
        }

        // Generate Invoice Number
        const count = await prisma.invoice.count();
        const invoiceNo = `INV-${String(count + 1).padStart(3, '0')}`;

        const amount = parseFloat(rent) + parseFloat(serviceFees || 0);

        const newInvoice = await prisma.invoice.create({
            data: {
                invoiceNo,
                tenantId: parseInt(tenantId),
                unitId: parseInt(unitId),
                month,
                rent: parseFloat(rent),
                serviceFees: parseFloat(serviceFees || 0),
                amount,
                status: 'draft'
            },
            include: {
                tenant: true,
                unit: true
            }
        });

        // Format for response to match getInvoices
        const formatted = {
            id: newInvoice.id,
            invoiceNo: newInvoice.invoiceNo,
            tenant: newInvoice.tenant.name,
            unit: newInvoice.unit.name,
            month: newInvoice.month,
            rent: parseFloat(newInvoice.rent),
            serviceFees: parseFloat(newInvoice.serviceFees),
            amount: parseFloat(newInvoice.amount),
            status: newInvoice.status
        };

        res.status(201).json(formatted);

    } catch (e) {
        console.error(e);
        res.status(500).json({ message: 'Error creating invoice' });
    }
};

// PUT /api/admin/invoices/:id (Update status or details)
// PUT /api/admin/invoices/:id (Update status or details)
exports.updateInvoice = async (req, res) => {
    try {
        const { status, month, rent, serviceFees, paymentMethod } = req.body;
        const id = parseInt(req.params.id);

        // Fetch existing to get current values if not provided?
        // Or assume provided. For simplicity, we update what is provided.
        // We need to recalc amount if rent/fees change.

        const data = {};
        if (status) {
            data.status = status;
            if (status.toLowerCase() === 'paid') {
                data.paidAt = new Date(); // Set paid date to now
                if (paymentMethod) data.paymentMethod = paymentMethod;
            }
        }
        if (month) data.month = month;

        let newRent = rent;
        let newFees = serviceFees;

        // If rent or fees updating, we need to ensure we have both to calc amount
        if (rent !== undefined || serviceFees !== undefined) {
            const existing = await prisma.invoice.findUnique({ where: { id } });
            if (rent !== undefined) newRent = parseFloat(rent); else newRent = Number(existing.rent);
            if (serviceFees !== undefined) newFees = parseFloat(serviceFees); else newFees = Number(existing.serviceFees);

            data.rent = newRent;
            data.serviceFees = newFees;
            data.amount = newRent + newFees;
        }

        const updated = await prisma.invoice.update({
            where: { id },
            data
        });
        res.json(updated);
    } catch (e) {
        console.error(e);
        res.status(500).json({ message: 'Error updating' });
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

const prisma = require('../../config/prisma');

// POST /api/tenant/pay
exports.processPayment = async (req, res) => {
    try {
        const userId = req.user.id;
        const { invoiceId, amount, paymentMethod } = req.body;

        if (!invoiceId || !amount) {
            return res.status(400).json({ message: 'Invoice ID and Amount are required' });
        }

        // 1. Get the invoice to verify ownership and amount
        const invoice = await prisma.invoice.findFirst({
            where: {
                id: invoiceId,
                tenantId: userId
            }
        });

        if (!invoice) {
            return res.status(404).json({ message: 'Invoice not found' });
        }

        // 2. Create Transaction Record
        const transaction = await prisma.transaction.create({
            data: {
                date: new Date(),
                description: `Rent Payment - ${invoice.month} (${paymentMethod || 'Card'})`,
                type: 'Income',
                amount: parseFloat(amount),
                status: 'Completed',
            }
        });

        // 3. Update Invoice Status
        const updatedInvoice = await prisma.invoice.update({
            where: { id: invoiceId },
            data: {
                status: 'paid', // Mark as paid lowercase
                paidAt: new Date()
            }
        });

        res.json({
            success: true,
            message: 'Payment processed successfully',
            transactionId: transaction.id,
            invoiceId: updatedInvoice.id
        });

    } catch (e) {
        console.error('Payment Error:', e);
        res.status(500).json({ message: 'Payment processing failed' });
    }
};

// POST /api/tenant/pay
exports.processPayment = async (req, res) => {
    try {
        const userId = req.user.id;
        const { invoiceId, amount, paymentMethod } = req.body;
        const payAmount = parseFloat(amount);

        if (!invoiceId || isNaN(payAmount) || payAmount <= 0) {
            return res.status(400).json({ message: 'Valid Invoice ID and Amount are required' });
        }

        const result = await prisma.$transaction(async (tx) => {
            // 1. Get the invoice and verify tenant ownership
            const invoice = await tx.invoice.findFirst({
                where: {
                    id: parseInt(invoiceId),
                    tenantId: userId
                }
            });

            if (!invoice) {
                throw new Error('Invoice not found or unauthorized');
            }

            // 2. Create Payment Record (Requirement 6)
            const payment = await tx.payment.create({
                data: {
                    invoiceId: invoice.id,
                    amount: payAmount,
                    method: paymentMethod || 'Online',
                    date: new Date()
                }
            });

            // 3. Update Invoice Status and Balances (Requirement 6)
            const currentPaid = parseFloat(invoice.paidAmount) || 0;
            const totalRequired = parseFloat(invoice.amount) || 0;

            const newPaidAmount = currentPaid + payAmount;
            const newBalanceDue = totalRequired - newPaidAmount;

            let status = 'partial';
            if (newBalanceDue <= 0) {
                status = 'paid';
            }

            const updatedInvoice = await tx.invoice.update({
                where: { id: invoice.id },
                data: {
                    paidAmount: newPaidAmount,
                    balanceDue: Math.max(0, newBalanceDue),
                    status: status,
                    paidAt: status === 'paid' ? new Date() : invoice.paidAt,
                    paymentMethod: paymentMethod || invoice.paymentMethod
                }
            });

            // 4. Create Ledger Transaction (Requirement 2 & 3)
            // Ensure a "Rent Income" account exists
            let rentAccount = await tx.account.findFirst({
                where: { accountName: 'Rent Income' }
            });

            if (!rentAccount) {
                rentAccount = await tx.account.create({
                    data: {
                        accountName: 'Rent Income',
                        assetType: 'Income',
                        openingBalance: 0
                    }
                });
            }

            // Simple running balance logic
            const lastTx = await tx.transaction.findFirst({
                orderBy: { id: 'desc' }
            });
            const prevBalance = lastTx ? parseFloat(lastTx.balance) : 0;

            const transaction = await tx.transaction.create({
                data: {
                    date: new Date(),
                    description: `Rent Payment - ${invoice.month} (Inv: ${invoice.invoiceNo})`,
                    type: 'Income',
                    amount: payAmount,
                    balance: prevBalance + payAmount,
                    status: 'Completed',
                    invoiceId: invoice.id,
                    paymentId: payment.id,
                    accountId: rentAccount.id
                }
            });

            return { payment, updatedInvoice, transaction };
        });

        res.json({
            success: true,
            message: 'Payment processed successfully',
            paymentId: result.payment.id,
            invoiceId: result.updatedInvoice.id,
            status: result.updatedInvoice.status,
            balanceDue: result.updatedInvoice.balanceDue
        });

    } catch (e) {
        console.error('Payment Error:', e);
        res.status(500).json({ message: e.message || 'Payment processing failed' });
    }
};

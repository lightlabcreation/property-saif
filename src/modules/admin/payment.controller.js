const prisma = require('../../config/prisma');
const { generateReceiptPDF } = require('../../utils/pdf.utils');

// GET /api/admin/payments/:id/download
exports.downloadReceiptPDF = async (req, res) => {
    try {
        const { id } = req.params;
        // Try finding by internal ID or invoiceNo
        const invoice = await prisma.invoice.findFirst({
            where: {
                OR: [
                    { id: isNaN(parseInt(id)) ? -1 : parseInt(id) },
                    { invoiceNo: id }
                ]
            },
            include: {
                tenant: true,
                unit: true
            }
        });

        if (!invoice) return res.status(404).json({ message: 'Receipt not found' });

        generateReceiptPDF(invoice, res);
    } catch (e) {
        console.error(e);
        res.status(500).json({ message: 'Error generating PDF' });
    }
};

exports.getOutstandingDues = async (req, res) => {
    try {
        const dues = await prisma.invoice.findMany({
            where: {
                status: {
                    not: 'paid'
                }
            },
            include: {
                tenant: true,
                unit: true
            },
            orderBy: {
                dueDate: 'asc'
            }
        });

        const formattedDues = dues.map(due => {
            const dueDate = due.dueDate ? new Date(due.dueDate) : new Date(due.createdAt); // Fallback if no dueDate
            const now = new Date();
            const diffTime = now - dueDate;
            const daysOverdue = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

            // Determine status dynamically based on date if not already 'paid'
            // If API status is 'draft', we might want to show it as 'Pending' or 'Overdue'
            let status = 'Pending';
            if (daysOverdue > 0) {
                status = 'Overdue';
            }

            return {
                id: due.id, // For selecting
                invoice: due.invoiceNo,
                tenant: due.tenant.name,
                unit: due.unit.name,
                leaseType: due.unit.rentalMode === 'FULL_UNIT' ? 'Full Unit' : 'Bedroom',
                amount: parseFloat(due.amount),
                dueDate: dueDate.toLocaleDateString('en-GB', {
                    day: '2-digit', month: 'short', year: 'numeric'
                }),
                daysOverdue: daysOverdue > 0 ? daysOverdue : 0,
                status: status
            };
        });

        res.json(formattedDues);
    } catch (error) {
        console.error('Error fetching outstanding dues:', error);
        res.status(500).json({ message: 'Error fetching outstanding dues' });
    }
};

exports.getReceivedPayments = async (req, res) => {
    try {
        const payments = await prisma.invoice.findMany({
            where: {
                status: 'paid'
            },
            include: {
                tenant: true,
                unit: true
            },
            orderBy: {
                paidAt: 'desc'
            }
        });

        const formattedPayments = payments.map(payment => {
            return {
                id: payment.invoiceNo,
                tenantId: payment.tenantId,
                unitId: payment.unitId,
                tenant: payment.tenant.name,
                unit: payment.unit.name,
                type: payment.unit.rentalMode === 'FULL_UNIT' ? 'Full Unit' : 'Bedroom',
                amount: parseFloat(payment.amount),
                method: payment.paymentMethod || 'N/A',
                date: payment.paidAt ? new Date(payment.paidAt).toLocaleDateString('en-GB', {
                    day: '2-digit', month: 'short', year: 'numeric'
                }) : '-',
                status: 'Paid' // Since we filtered by 'paid'
            };
        });

        res.json(formattedPayments);
    } catch (error) {
        console.error('Error fetching payments:', error);
        res.status(500).json({ message: 'Error fetching payments' });
    }
};

// POST /api/admin/payments (Record Payment)
exports.recordPayment = async (req, res) => {
    try {
        const { invoiceId, amount, paymentMethod } = req.body;
        const payAmount = parseFloat(amount);

        if (!invoiceId || isNaN(payAmount) || payAmount <= 0) {
            return res.status(400).json({ message: 'Valid Invoice ID and Amount are required' });
        }

        const result = await prisma.$transaction(async (tx) => {
            // 1. Get the invoice
            const invoice = await tx.invoice.findUnique({
                where: { id: parseInt(invoiceId) }
            });

            if (!invoice) {
                throw new Error('Invoice not found');
            }

            // 2. Create Payment Record
            const payment = await tx.payment.create({
                data: {
                    invoiceId: invoice.id,
                    amount: payAmount,
                    method: paymentMethod || 'Cash',
                    date: new Date()
                }
            });

            // 3. Update Invoice Status and Balances
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

            // 4. Create Ledger Transaction
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

            const lastTx = await tx.transaction.findFirst({
                orderBy: { id: 'desc' }
            });
            const prevBalance = lastTx ? parseFloat(lastTx.balance) : 0;

            const transaction = await tx.transaction.create({
                data: {
                    date: new Date(),
                    description: `Payment - ${invoice.month} (Inv: ${invoice.invoiceNo})`,
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
            message: 'Payment recorded successfully',
            paymentId: result.payment.id,
            invoiceId: result.updatedInvoice.id,
            status: result.updatedInvoice.status,
            balanceDue: result.updatedInvoice.balanceDue
        });

    } catch (e) {
        console.error('Payment Error:', e);
        res.status(500).json({ message: e.message || 'Payment recording failed' });
    }
};

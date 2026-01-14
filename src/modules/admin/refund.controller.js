const prisma = require('../../config/prisma');

// GET /api/admin/refunds
exports.getRefunds = async (req, res) => {
    try {
        const refunds = await prisma.refundAdjustment.findMany({
            include: {
                tenant: true,
                unit: true
            },
            orderBy: {
                date: 'desc'
            }
        });

        const formatted = refunds.map(r => ({
            id: r.requestId,
            type: r.type,
            reason: r.reason,
            tenant: r.tenant.name,
            unit: r.unit.name,
            amount: parseFloat(r.amount),
            date: r.date.toLocaleDateString('en-GB', {
                day: '2-digit', month: 'short', year: 'numeric'
            }),
            status: r.status
        }));

        res.json(formatted);
    } catch (e) {
        console.error(e);
        res.status(500).json({ message: 'Server error' });
    }
};

// POST /api/admin/refunds
exports.createRefund = async (req, res) => {
    try {
        const { type, reason, tenantId, unitId, amount, status, date } = req.body;

        const result = await prisma.$transaction(async (tx) => {
            const count = await tx.refundAdjustment.count();
            const requestId = `RA-${String(count + 1).padStart(5, '0')}`;

            const refundamt = parseFloat(amount) || 0;

            const refund = await tx.refundAdjustment.create({
                data: {
                    requestId,
                    type,
                    reason,
                    tenantId: parseInt(tenantId),
                    unitId: parseInt(unitId),
                    amount: refundamt,
                    status: status || 'Completed',
                    date: date ? new Date(date) : new Date()
                }
            });

            // Notification for Security Deposit (Requirement from user)
            if (type.toLowerCase().includes('deposit') || reason.toLowerCase().includes('deposit')) {
                await tx.message.create({
                    data: {
                        content: `Notification: A ${type} of $${refundamt} has been processed for your account. Reason: ${reason}`,
                        senderId: req.user?.id || 1, // Fallback to 1 (Admin) if auth middleware is off
                        receiverId: parseInt(tenantId)
                    }
                });
            }

            // Ledger Entry (Accounting Requirement)
            const lastTx = await tx.transaction.findFirst({ orderBy: { id: 'desc' } });
            const prevBalance = lastTx ? parseFloat(lastTx.balance) : 0;

            await tx.transaction.create({
                data: {
                    date: new Date(),
                    description: `${type} Refund - ${requestId}`,
                    type: type.toLowerCase().includes('deposit') ? 'Liability' : 'Expense',
                    amount: refundamt,
                    balance: prevBalance - refundamt,
                    status: 'Completed'
                }
            });

            return refund;
        });

        res.status(201).json(result);
    } catch (e) {
        console.error(e);
        res.status(500).json({ message: 'Error creating refund' });
    }
};

// PUT /api/admin/refunds/:id
exports.updateRefund = async (req, res) => {
    try {
        const { status, reason, amount } = req.body;
        const { id } = req.params;

        const updated = await prisma.refundAdjustment.update({
            where: { requestId: id },
            data: {
                status,
                reason,
                amount: amount ? parseFloat(amount) : undefined
            }
        });

        res.json(updated);
    } catch (e) {
        console.error(e);
        res.status(500).json({ message: 'Error updating refund' });
    }
};

// DELETE /api/admin/refunds/:id
exports.deleteRefund = async (req, res) => {
    try {
        const { id } = req.params;
        await prisma.refundAdjustment.delete({
            where: { requestId: id }
        });
        res.json({ message: 'Refund record deleted' });
    } catch (e) {
        console.error(e);
        res.status(500).json({ message: 'Error deleting refund' });
    }
};

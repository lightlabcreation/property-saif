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

        // Fetch Branding Settings
        const settingsList = await prisma.systemSetting.findMany();
        const settings = {};
        settingsList.forEach(s => {
            // Map internal keys to PDF-expected keys
            if (s.key === 'companyName') settings['company_name'] = s.value;
            else if (s.key === 'companyAddress') settings['company_address'] = s.value;
            else settings[s.key] = s.value;
        });

        generateInvoicePDF(invoice, res, settings);
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
                unit: true,
                lease: true // Include lease to check rentAmount
            },
            orderBy: { createdAt: 'desc' }
        });

        // SAFETY NET: Auto-correct unpaid $0 invoices before returning
        const formatted = await Promise.all(invoices.map(async (inv) => {
            let currentAmount = parseFloat(inv.amount);
            let currentRent = parseFloat(inv.rent);
            let currentStatus = inv.status.toLowerCase();

            if (currentStatus !== 'paid' && currentAmount === 0 && inv.lease && parseFloat(inv.lease.monthlyRent) > 0) {
                const rentAmt = parseFloat(inv.lease.monthlyRent);
                // Update in DB for persistence
                await prisma.invoice.update({
                    where: { id: inv.id },
                    data: {
                        rent: rentAmt,
                        amount: rentAmt,
                        balanceDue: rentAmt
                    }
                });
                currentAmount = rentAmt;
                currentRent = rentAmt;
            }

            // Find active lease to get dates for UI
            const activeLease = inv.tenant.leases.find(l => l.status === 'Active' || l.status === 'DRAFT');

            return {
                id: inv.id,
                invoiceNo: inv.invoiceNo,
                tenantId: inv.tenantId,
                unitId: inv.unitId,
                tenant: inv.tenant.name,
                unit: inv.unit.name,
                month: inv.month,
                rent: currentRent,
                serviceFees: parseFloat(inv.serviceFees),
                amount: currentAmount,
                status: inv.status,
                category: inv.category,
                description: inv.description,
                leaseStartDate: activeLease?.startDate || null,
                leaseEndDate: activeLease?.endDate || null
            };
        }));

        res.json(formatted);
    } catch (e) {
        console.error(e);
        res.status(500).json({ message: 'Server error' });
    }
};

// POST /api/admin/invoices (Create draft)
exports.createInvoice = async (req, res) => {
    try {
        let { tenantId, unitId, month, rent, serviceFees } = req.body;

        if (!tenantId || !unitId) {
            return res.status(400).json({ message: 'Tenant ID and Unit ID are required' });
        }

        // 1. Find Active Lease for this tenant and unit
        const activeLease = await prisma.lease.findFirst({
            where: {
                tenantId: parseInt(tenantId),
                unitId: parseInt(unitId),
                status: 'Active'
            },
            include: { unit: true, tenant: true }
        });

        if (!activeLease) {
            return res.status(400).json({ message: 'Invoices can only be generated for ACTIVE leases.' });
        }

        // Determine who to bill: If tenant is a RESIDENT, bill their Parent
        let billableTenantId = parseInt(tenantId);
        if (activeLease.tenant.type === 'RESIDENT') {
            if (!activeLease.tenant.parentId) {
                return res.status(400).json({ message: 'Resident has no billable parent assigned.' });
            }
            billableTenantId = activeLease.tenant.parentId;
        }

        // Note: RESIDENT is not a tenant type - only INDIVIDUAL and COMPANY are valid tenant types
        // Residents are separate entities linked to tenant leases, not direct lease holders

        // ENFORCE PHASE 1 & 3: Separation and Lease Source of Truth
        const rentAmt = parseFloat(rent) || 0;
        const feesAmt = parseFloat(serviceFees) || 0;

        if (rentAmt > 0 && feesAmt > 0) {
            return res.status(400).json({ message: 'Rent and Service Fees must be on separate invoices.' });
        }

        // If creating a rent invoice, ensure it matches the lease
        let finalRent = rentAmt;
        if (rentAmt > 0) {
            finalRent = parseFloat(activeLease.monthlyRent) || 0;
        }

        const totalAmount = finalRent + feesAmt;

        // Generate Invoice Number
        const count = await prisma.invoice.count();
        const invoiceNo = `INV-MAN-${String(count + 1).padStart(5, '0')}`;

        const newInvoice = await prisma.invoice.create({
            data: {
                invoiceNo,
                tenantId: billableTenantId,
                unitId: parseInt(unitId),
                leaseId: activeLease.id,
                leaseType: activeLease.unit.rentalMode,
                month,
                rent: finalRent,
                serviceFees: feesAmt,
                amount: totalAmount,
                paidAmount: 0,
                balanceDue: totalAmount,
                status: 'draft',
                category: req.body.category || 'RENT',
                description: req.body.description || null
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
        if (req.body.description !== undefined) data.description = req.body.description;
        if (req.body.category) data.category = req.body.category;

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
            const upRent = rent !== undefined ? parseFloat(rent) : Number(existing.rent);
            const upFees = serviceFees !== undefined ? parseFloat(serviceFees) : Number(existing.serviceFees);

            if (upRent > 0 && upFees > 0) {
                return res.status(400).json({ message: 'Rent and Service Fees must be on separate invoices.' });
            }

            data.rent = upRent;
            data.serviceFees = upFees;
            data.amount = upRent + upFees;
            // Recalc balance based on what was already paid
            data.balanceDue = (upRent + upFees) - Number(existing.paidAmount);
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

// POST /api/admin/invoices/batch (Trigger manual batch run)
exports.runBatchInvoicing = async (req, res) => {
    console.log('[Batch Rent Run] Starting execution...');
    const today = new Date();
    const currentMonth = today.toLocaleString('default', { month: 'long', year: 'numeric' });

    // 1. Initialize RentRun Record
    const rentRun = await prisma.rentRun.create({
        data: {
            month: currentMonth,
            status: 'Pending'
        }
    });

    let createdCount = 0;
    let skippedCount = 0;
    let totalAmount = 0;

    try {
        const activeLeases = await prisma.lease.findMany({
            where: {
                status: 'Active',
                startDate: { lte: today },
                endDate: { gte: today },
                // Only include leases for actual tenants (INDIVIDUAL or COMPANY)
                // Residents are separate entities and cannot have direct leases
                tenant: {
                    type: { in: ['INDIVIDUAL', 'COMPANY', 'RESIDENT'] }
                }
            },
            include: { unit: true, tenant: true }
        });

        for (const lease of activeLeases) {
            try {
                // 2. Idempotency Check
                const existing = await prisma.invoice.findFirst({
                    where: { leaseId: lease.id, month: currentMonth, rent: { gt: 0 } }
                });

                if (existing) {
                    await prisma.rentRunLog.create({
                        data: {
                            runId: rentRun.id,
                            leaseId: lease.id,
                            status: 'Skipped',
                            message: 'Rent invoice already exists for this period.'
                        }
                    });
                    skippedCount++;
                    continue;
                }

                const rentAmount = parseFloat(lease.monthlyRent) || 0;

                if (rentAmount <= 0) {
                    await prisma.rentRunLog.create({
                        data: {
                            runId: rentRun.id,
                            leaseId: lease.id,
                            status: 'Skipped',
                            message: 'Lease monthlyRent is 0 or invalid.'
                        }
                    });
                    skippedCount++;
                    continue;
                }

                // 3. Generate Invoice
                const count = await prisma.invoice.count();
                const invoiceNo = `INV-BATCH-${String(count + 1).padStart(5, '0')}`;
                const dueDate = new Date(today.getFullYear(), today.getMonth(), 10); // 10th of month

                // Determine who to bill: If tenant is a RESIDENT, bill their Parent
                const billableTenantId = lease.tenant.type === 'RESIDENT' ? lease.tenant.parentId : lease.tenantId;

                if (!billableTenantId) {
                    await prisma.rentRunLog.create({
                        data: {
                            runId: rentRun.id,
                            leaseId: lease.id,
                            status: 'Skipped',
                            message: 'No billable tenant (parent) found for this resident.'
                        }
                    });
                    skippedCount++;
                    continue;
                }

                await prisma.invoice.create({
                    data: {
                        invoiceNo,
                        tenantId: billableTenantId,
                        unitId: lease.unitId,
                        leaseId: lease.id,
                        leaseType: lease.unit.rentalMode,
                        month: currentMonth,
                        rent: rentAmount,
                        serviceFees: 0,
                        amount: rentAmount,
                        paidAmount: 0,
                        balanceDue: rentAmount,
                        status: 'sent',
                        dueDate: dueDate
                    }
                });

                await prisma.rentRunLog.create({
                    data: {
                        runId: rentRun.id,
                        leaseId: lease.id,
                        status: 'Success',
                        message: `Invoice ${invoiceNo} generated.`
                    }
                });

                createdCount++;
                totalAmount += rentAmount;

            } catch (innerError) {
                console.error(`[Batch Run] Error processing Lease ID ${lease.id}:`, innerError);
                await prisma.rentRunLog.create({
                    data: {
                        runId: rentRun.id,
                        leaseId: lease.id,
                        status: 'Error',
                        message: innerError.message || 'Unknown processing error.'
                    }
                });
                skippedCount++;
            }
        }

        // 4. Update RentRun with results
        await prisma.rentRun.update({
            where: { id: rentRun.id },
            data: {
                status: 'Completed',
                createdCount,
                skippedCount,
                totalAmount
            }
        });

        res.json({ message: 'Batch run complete', createdCount, skippedCount, runId: rentRun.id });
    } catch (e) {
        console.error('[Batch Run] Critical Error:', e);
        await prisma.rentRun.update({
            where: { id: rentRun.id },
            data: { status: 'Failed' }
        });
        res.status(500).json({ message: 'Error in batch generation' });
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

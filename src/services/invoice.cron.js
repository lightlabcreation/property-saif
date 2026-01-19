const cron = require('node-cron');
const prisma = require('../config/prisma');

/**
 * Monthly Invoice Generation Cron Job
 * Runs once per month (default: 1st at midnight)
 * Finds all active leases and generates an invoice for the upcoming month
 */
const initMonthlyInvoiceCron = () => {
    // Default: 1st of every month at midnight
    const cronTime = process.env.INVOICE_CRON_TIME || '0 0 1 * *';

    console.log(`[Cron] Initializing Monthly Invoice cron with schedule: ${cronTime}`);

    cron.schedule(cronTime, async () => {
        console.log('[Cron] Running monthly invoice generation...');
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
                    tenant: {
                        type: { not: 'RESIDENT' }
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
                                message: 'Automated: Rent invoice already exists for this period.'
                            }
                        });
                        skippedCount++;
                        continue;
                    }

                    const rentAmt = parseFloat(lease.monthlyRent) || 0;
                    if (rentAmt <= 0) {
                        await prisma.rentRunLog.create({
                            data: {
                                runId: rentRun.id,
                                leaseId: lease.id,
                                status: 'Skipped',
                                message: 'Automated: Lease monthlyRent is 0 or invalid.'
                            }
                        });
                        skippedCount++;
                        continue;
                    }

                    // 3. Generate Invoice
                    const count = await prisma.invoice.count();
                    const invoiceNo = `INV-AUTO-${String(count + 1).padStart(5, '0')}`;
                    const dueDate = new Date(today.getFullYear(), today.getMonth(), 5);

                    await prisma.invoice.create({
                        data: {
                            invoiceNo,
                            tenantId: lease.tenantId,
                            unitId: lease.unitId,
                            leaseId: lease.id,
                            leaseType: lease.unit.rentalMode,
                            month: currentMonth,
                            rent: rentAmt,
                            serviceFees: 0,
                            amount: rentAmt,
                            paidAmount: 0,
                            balanceDue: rentAmt,
                            status: 'sent',
                            dueDate: dueDate
                        }
                    });

                    await prisma.rentRunLog.create({
                        data: {
                            runId: rentRun.id,
                            leaseId: lease.id,
                            status: 'Success',
                            message: `Automated: Invoice ${invoiceNo} generated.`
                        }
                    });

                    createdCount++;
                    totalAmount += rentAmt;

                } catch (innerErr) {
                    console.error(`[Cron] Error processing Lease ID ${lease.id}:`, innerErr);
                    await prisma.rentRunLog.create({
                        data: {
                            runId: rentRun.id,
                            leaseId: lease.id,
                            status: 'Error',
                            message: `Automated Error: ${innerErr.message}`
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

            console.log(`[Cron] Batch run complete. Created: ${createdCount}, Skipped: ${skippedCount}`);
        } catch (error) {
            console.error('[Cron] Fatal error in monthly invoice cron job:', error);
            await prisma.rentRun.update({
                where: { id: rentRun.id },
                data: { status: 'Failed' }
            });
        }
    });
};

module.exports = { initMonthlyInvoiceCron };

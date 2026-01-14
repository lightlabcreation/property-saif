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

        // We usually bill for the current month if it's the 1st
        const currentMonth = today.toLocaleString('default', { month: 'long', year: 'numeric' });

        try {
            const activeLeases = await prisma.lease.findMany({
                where: {
                    status: 'Active',
                    startDate: { lte: today },
                    endDate: { gte: today }
                }
            });

            if (activeLeases.length === 0) {
                console.log('[Cron] No active leases found for invoice generation.');
                return;
            }

            for (const lease of activeLeases) {
                try {
                    // 1. Idempotency Check: Does this lease already have an invoice for this month?
                    const existing = await prisma.invoice.findFirst({
                        where: {
                            tenantId: lease.tenantId,
                            unitId: lease.unitId,
                            month: currentMonth
                        }
                    });

                    if (existing) {
                        console.log(`[Cron] Invoice already exists for Lease ${lease.id} for ${currentMonth}. Skipping.`);
                        continue;
                    }

                    // 2. Generate New Invoice
                    const count = await prisma.invoice.count();
                    const invoiceNo = `INV-AUTO-${String(count + 1).padStart(5, '0')}`;

                    const rentAmount = parseFloat(lease.monthlyRent) || 0;
                    // Default service fees to 0 unless we have a logic for it
                    const serviceFees = 0;
                    const totalAmount = rentAmount + serviceFees;

                    // Due date: 5th of the current month
                    const dueDate = new Date(today.getFullYear(), today.getMonth(), 5);

                    await prisma.invoice.create({
                        data: {
                            invoiceNo,
                            tenantId: lease.tenantId,
                            unitId: lease.unitId,
                            month: currentMonth,
                            rent: rentAmount,
                            serviceFees: serviceFees,
                            amount: totalAmount,
                            paidAmount: 0,
                            balanceDue: totalAmount,
                            status: 'sent', // 'sent' means active/unpaid
                            dueDate: dueDate,
                        }
                    });

                    console.log(`[Cron] Generated automated invoice ${invoiceNo} for Lease ${lease.id} (${currentMonth})`);
                } catch (err) {
                    console.error(`[Cron] Error generating invoice for Lease ${lease.id}:`, err);
                }
            }
        } catch (error) {
            console.error('[Cron] Fatal error in monthly invoice cron job:', error);
        }
    });
};

module.exports = { initMonthlyInvoiceCron };

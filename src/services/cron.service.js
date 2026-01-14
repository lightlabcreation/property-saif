const cron = require('node-cron');
const prisma = require('../config/prisma');

/**
 * Lease Expiry Cron Job
 * Runs once per day at midnight (or configured CRON_TIME)
 * Finds active leases that have passed their end date
 * Updates lease status to 'Expired'
 * Updates unit status to 'Vacant'
 */
const initLeaseCron = () => {
    const cronTime = process.env.CRON_TIME || '0 0 * * *';

    console.log(`[Cron] Initializing Lease Expiry cron with schedule: ${cronTime}`);

    cron.schedule(cronTime, async () => {
        console.log('[Cron] Running daily lease expiry check...');
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        try {
            // Transaction for consistency
            const result = await prisma.$transaction(async (tx) => {
                // 1. Find all active leases that have ended
                const expiredLeases = await tx.lease.findMany({
                    where: {
                        status: 'Active',
                        endDate: {
                            lt: today
                        }
                    },
                    include: {
                        unit: true
                    }
                });

                if (expiredLeases.length === 0) {
                    return { processed: 0, failed: 0 };
                }

                let processedCount = 0;
                let failedCount = 0;

                for (const lease of expiredLeases) {
                    try {
                        // 2. Update lease status to Expired
                        await tx.lease.update({
                            where: { id: lease.id },
                            data: { status: 'Expired' }
                        });

                        // 3. Update unit status to Vacant, but ONLY if not Under Maintenance
                        // and check if there are any other active/draft leases for this unit (safety check)
                        const otherActiveLeases = await tx.lease.findMany({
                            where: {
                                unitId: lease.unitId,
                                status: { in: ['Active', 'DRAFT'] },
                                NOT: { id: lease.id }
                            }
                        });

                        if (lease.unit.status !== 'Under Maintenance' && otherActiveLeases.length === 0) {
                            await tx.unit.update({
                                where: { id: lease.unitId },
                                data: { status: 'Vacant' }
                            });
                        }

                        processedCount++;
                    } catch (err) {
                        console.error(`[Cron] Error processing lease ${lease.id}:`, err);
                        failedCount++;
                    }
                }

                return { processed: processedCount, failed: failedCount };
            });

            console.log(`[Cron] Lease expiry check completed. Summary: Processed: ${result.processed}, Failed: ${result.failed}`);
        } catch (error) {
            console.error('[Cron] Fatal error in lease expiry cron job:', error);
        }
    });
};

module.exports = { initLeaseCron };

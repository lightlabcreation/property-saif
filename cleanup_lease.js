const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    console.log('--- CLEANUP: Deleting Lease ID 3 ---');

    // Deleting specific stuck lease
    try {
        // First, find it to get tenant ID
        const lease = await prisma.lease.findUnique({ where: { id: 3 }, include: { tenant: true } });
        if (lease) {
            console.log(`Found lease 3 for Tenant: ${lease.tenant?.name}`);

            await prisma.$transaction(async (tx) => {
                // Reset Tenant Fields
                if (lease.tenant) {
                    await tx.user.update({
                        where: { id: lease.tenantId },
                        data: { unitId: null, bedroomId: null, buildingId: null }
                    });
                    console.log('Reset tenant fields.');
                }

                // Delete Lease
                await tx.lease.delete({ where: { id: 3 } });
                console.log('Deleted Lease ID 3.');

                // Ensure C-750 is Vacant
                await tx.unit.update({
                    where: { id: lease.unitId },
                    data: { status: 'Vacant', rentalMode: 'FULL_UNIT' } // Valid enum value
                });
                console.log('Reset Unit C-750 to Vacant.');
            });
        } else {
            console.log('Lease ID 3 not found (maybe already deleted).');
        }
    } catch (e) {
        console.error('Error:', e);
    }
}

main()
    .catch(e => console.error(e))
    .finally(async () => await prisma.$disconnect());

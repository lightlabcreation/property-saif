const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    console.log('--- DB INSPECTION: Units & Statuses ---');

    const units = await prisma.unit.findMany({
        include: {
            leases: {
                where: { status: 'Active' },
                select: { id: true, status: true }
            }
        }
    });

    console.log(`Total Units Found: ${units.length}`);
    console.log('------------------------------------------------');
    units.forEach(u => {
        // Only show interesting units (occupied/leased) to keep log short
        if (u.status !== 'Vacant' || u.leases.length > 0) {
            console.log(`Unit ID: ${u.id} | No: ${u.unitNumber}`);
            console.log(`   Status:      "${u.status}"`);
            console.log(`   RentalMode:  "${u.rentalMode}"`);
            console.log(`   ActiveLeases: ${u.leases.length}`);
            console.log('------------------------------------------------');
        }
    });
}

main()
    .catch(e => console.error(e))
    .finally(async () => await prisma.$disconnect());

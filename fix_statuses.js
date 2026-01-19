const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    console.log('--- FIXING UNIT STATUSES ---');

    // Find units that have active leases but are not "Fully Booked"
    const unitsToFix = await prisma.unit.findMany({
        where: {
            leases: { some: { status: 'Active' } },
            status: { not: 'Fully Booked' }
        },
        include: {
            leases: { where: { status: 'Active' } }
        }
    });

    for (const u of unitsToFix) {
        // If it's a Full Unit lease, mark as Fully Booked
        if (u.rentalMode === 'FULL_UNIT') {
            console.log(`Fixing Unit ${u.unitNumber} (ID: ${u.id}): FULL_UNIT -> Fully Booked`);
            await prisma.unit.update({
                where: { id: u.id },
                data: { status: 'Fully Booked' }
            });
            // Also mark all bedrooms as Occupied
            await prisma.bedroom.updateMany({
                where: { unitId: u.id },
                data: { status: 'Occupied' }
            });
        } else {
            // For Bedroom-wise, let's just make sure it's at least 'Occupied'
            console.log(`Fixing Unit ${u.unitNumber} (ID: ${u.id}): BEDROOM_WISE -> Occupied`);
            await prisma.unit.update({
                where: { id: u.id },
                data: { status: 'Occupied' }
            });
        }
    }

    console.log('Done.');
}

main()
    .catch(e => console.error(e))
    .finally(async () => await prisma.$disconnect());

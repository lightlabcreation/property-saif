const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    console.log('--- UNITS ---');
    const units = await prisma.unit.findMany({
        include: {
            bedroomsList: true,
            leases: {
                where: { status: 'Active' }
            }
        }
    });

    units.forEach(u => {
        console.log(`Unit: ${u.unitNumber} (ID: ${u.id})`);
        console.log(`  Status: "${u.status}"`);
        console.log(`  Rental Mode: ${u.rentalMode}`);
        console.log(`  Active Leases: ${u.leases.length}`);
        console.log(`  Bedrooms: ${u.bedroomsList.length}`);
        u.bedroomsList.forEach(b => {
            console.log(`    - Bedroom: ${b.bedroomNumber} (Status: "${b.status}")`);
        });
        console.log('');
    });
}

main()
    .catch(e => console.error(e))
    .finally(async () => await prisma.$disconnect());

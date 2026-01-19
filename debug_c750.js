const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    console.log('--- DEBUG: Unit C-750 (Inspection) ---');

    // Find unit by name or number "C-750"
    // Note: Schema has unitNumber or name. We check both.
    const units = await prisma.unit.findMany({
        where: {
            OR: [
                { unitNumber: { contains: 'C-750' } },
                { name: { contains: 'C-750' } }
            ]
        },
        include: {
            bedroomsList: true,
            leases: {
                include: { tenant: true }
            }
        }
    });

    if (units.length === 0) {
        console.log('No unit found matching C-750');
    }

    units.forEach(u => {
        console.log(`Unit: ${u.unitNumber || u.name} (ID: ${u.id})`);
        console.log(`  Status:      "${u.status}"`);
        console.log(`  RentalMode:  "${u.rentalMode}"`);
        console.log(`  Leases:`);
        u.leases.forEach(l => {
            console.log(`    - ID: ${l.id}, Status: ${l.status}, Tenant: ${l.tenant?.name}, Start: ${l.startDate}`);
        });
        console.log(`  Bedrooms:`);
        u.bedroomsList.forEach(b => {
            console.log(`    - Bedroom: ${b.bedroomNumber} (Status: "${b.status}")`);
        });
        console.log('------------------------------------------------');
    });
}

main()
    .catch(e => console.error(e))
    .finally(async () => await prisma.$disconnect());

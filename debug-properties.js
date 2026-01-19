const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkProperties() {
    try {
        console.log('--- Checking Properties in DB ---');
        const allProperties = await prisma.property.findMany();
        console.log(`Total Properties: ${allProperties.length}`);

        console.log('\n--- Property Details (ID, Name, Status, OwnerID) ---');
        allProperties.forEach(p => {
            console.log(`ID: ${p.id}, Name: "${p.name}", Status: "${p.status}", OwnerId: ${p.ownerId}`);
        });

        console.log('\n--- Testing Filter Logic ---');
        const activeProps = allProperties.filter(p => p.status === 'Active');
        console.log(`Properties with status === 'Active': ${activeProps.length}`);

        const unassignedProps = activeProps.filter(p => !p.ownerId);
        console.log(`Properties Active AND Unassigned: ${unassignedProps.length}`);

    } catch (e) {
        console.error(e);
    } finally {
        await prisma.$disconnect();
    }
}

checkProperties();

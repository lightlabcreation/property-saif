const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const { VALID_UNIT_TYPES } = require('../src/config/unitTypes');

async function seedUnitTypes() {
    const unitTypes = VALID_UNIT_TYPES;

    console.log('Seeding unit types...');

    for (const typeName of unitTypes) {
        await prisma.unitType.upsert({
            where: { name: typeName },
            update: {},
            create: {
                name: typeName,
                isActive: true
            }
        });
        console.log(`✓ ${typeName}`);
    }

    console.log('Unit types seeded successfully!');
}

seedUnitTypes()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });

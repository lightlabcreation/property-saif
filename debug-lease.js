const prisma = require('./src/config/prisma');
require('dotenv').config();

async function debugLease() {
    try {
        const users = await prisma.user.findMany({
            where: { role: 'TENANT' },
            include: {
                leases: true
            }
        });
        console.log('--- Tenants and their Leases ---');
        users.forEach(u => {
            console.log(`User: ${u.email} (ID: ${u.id})`);
            console.log(`Leases: ${u.leases.length}`);
            u.leases.forEach(l => {
                console.log(`  - Lease ID: ${l.id}, Status: ${l.status}, UnitID: ${l.unitId}`);
            });
        });
    } catch (e) {
        console.error(e);
    } finally {
        await prisma.$disconnect();
    }
}

debugLease();

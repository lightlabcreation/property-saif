const prisma = require('./src/config/prisma');

async function checkSettings() {
    try {
        const settings = await prisma.systemSetting.findMany();
        console.log('Current System Settings:');
        settings.forEach(s => {
            console.log(`${s.key}: ${s.value}`);
        });
        process.exit(0);
    } catch (error) {
        console.error('Error fetching settings:', error);
        process.exit(1);
    }
}

checkSettings();

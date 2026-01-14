const prisma = require('../../config/prisma');

// GET /api/admin/settings
exports.getSettings = async (req, res) => {
    try {
        const settings = await prisma.systemSetting.findMany();
        const settingsMap = {};
        settings.forEach(s => {
            settingsMap[s.key] = s.value; // Values are strings
        });

        // Count active users for status card
        const userCount = await prisma.user.count({ where: { role: { not: 'ADMIN' } } });

        res.json({
            settings: settingsMap,
            stats: {
                activeUsers: userCount,
                systemStatus: 'All Services Running', // Mocked check
                storageUsage: '45% Used', // Mocked
                lastBackup: new Date().toISOString() // Mocked
            }
        });
    } catch (e) {
        console.error(e);
        res.status(500).json({ message: 'Server error' });
    }
};

// POST /api/admin/settings
exports.updateSettings = async (req, res) => {
    try {
        const updates = req.body; // { key: value, key2: value2 }

        const promises = Object.keys(updates).map(key => {
            let val = updates[key];
            if (typeof val !== 'string') val = JSON.stringify(val); // Ensure string storage

            return prisma.systemSetting.upsert({
                where: { key: key },
                update: { value: val },
                create: { key: key, value: val }
            });
        });

        await Promise.all(promises);
        res.json({ message: 'Saved' });
    } catch (e) {
        console.error(e);
        res.status(500).json({ message: 'Error saving settings' });
    }
};

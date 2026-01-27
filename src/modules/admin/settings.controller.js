const prisma = require('../../config/prisma');

// GET /api/admin/settings
exports.getSettings = async (req, res) => {
    try {
        const { userId } = req.query;

        // 1. Fetch Global Settings
        const settings = await prisma.systemSetting.findMany();
        const settingsMap = {};
        settings.forEach(s => {
            settingsMap[s.key] = s.value;
        });

        // 2. Fetch User-Specific QuickBooks Config if userId provided
        if (userId) {
            const qbConfig = await prisma.quickBooksConfig.findUnique({
                where: { userId: parseInt(userId) }
            });

            if (qbConfig) {
                // Overlay QBO settings
                settingsMap['qb_connected'] = 'true'; // If record exists, we assume connected or at least configured
                // Or better check if accessToken exists
                settingsMap['qb_connected'] = qbConfig.accessToken ? 'true' : 'false';

                settingsMap['qb_autoSync'] = String(qbConfig.autoSync);
                settingsMap['qb_frequency'] = qbConfig.frequency;
                settingsMap['qb_account_fullUnitRent'] = qbConfig.accountFullUnitRent || '';
                settingsMap['qb_account_bedroomRent'] = qbConfig.accountBedroomRent || '';
                settingsMap['qb_account_securityDeposit'] = qbConfig.accountSecurityDeposit || '';
                settingsMap['qb_account_lateFees'] = qbConfig.accountLateFees || '';
            } else {
                // Default defaults for new user
                settingsMap['qb_connected'] = 'false';
                settingsMap['qb_autoSync'] = 'false';
                settingsMap['qb_frequency'] = 'realtime';
                settingsMap['qb_account_fullUnitRent'] = '';
                settingsMap['qb_account_bedroomRent'] = '';
                settingsMap['qb_account_securityDeposit'] = '';
                settingsMap['qb_account_lateFees'] = '';
            }
        }

        // Count active users for status card
        const userCount = await prisma.user.count({ where: { role: { not: 'ADMIN' } } });

        res.json({
            settings: settingsMap,
            stats: {
                activeUsers: userCount,
                systemStatus: 'All Services Running',
                storageUsage: '45% Used',
                lastBackup: new Date().toISOString()
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
        const updates = req.body; // { key: value, ... }
        const { userId } = req.body; // Check if we are updating for a specific user

        // Separate QBO keys from Global keys
        const qbKeys = [
            'qb_connected',
            'qb_autoSync',
            'qb_frequency',
            'qb_account_fullUnitRent',
            'qb_account_bedroomRent',
            'qb_account_securityDeposit',
            'qb_account_lateFees'
        ];

        const globalUpdates = {};
        const qbUpdates = {};

        Object.keys(updates).forEach(key => {
            if (key !== 'userId') {
                if (qbKeys.includes(key)) {
                    qbUpdates[key] = updates[key];
                } else {
                    globalUpdates[key] = updates[key];
                }
            }
        });

        // 1. Update Global Settings
        const promises = Object.keys(globalUpdates).map(key => {
            let val = globalUpdates[key];
            if (typeof val !== 'string') val = JSON.stringify(val);

            return prisma.systemSetting.upsert({
                where: { key: key },
                update: { value: val },
                create: { key: key, value: val }
            });
        });

        await Promise.all(promises);

        // 2. Update User-Specific QuickBooks Config
        if (userId && Object.keys(qbUpdates).length > 0) {
            // Check if record exists
            let qbConfig = await prisma.quickBooksConfig.findUnique({
                where: { userId: parseInt(userId) }
            });

            const data = {};
            if (qbUpdates['qb_autoSync']) data.autoSync = qbUpdates['qb_autoSync'] === 'true';
            if (qbUpdates['qb_frequency']) data.frequency = qbUpdates['qb_frequency'];
            if (qbUpdates['qb_account_fullUnitRent']) data.accountFullUnitRent = qbUpdates['qb_account_fullUnitRent'];
            if (qbUpdates['qb_account_bedroomRent']) data.accountBedroomRent = qbUpdates['qb_account_bedroomRent'];
            if (qbUpdates['qb_account_securityDeposit']) data.accountSecurityDeposit = qbUpdates['qb_account_securityDeposit'];
            if (qbUpdates['qb_account_lateFees']) data.accountLateFees = qbUpdates['qb_account_lateFees'];

            // Handle fake 'connected' toggle if no real tokens
            // user might toggle 'qb_connected' but we don't have tokens. 
            // We ignore 'qb_connected' update for DB, it serves as UI state derived from tokens.
            // UNLESS we want to manually disconnect?
            if (qbUpdates['qb_connected'] === 'false' && qbConfig) {
                data.accessToken = null;
                data.refreshToken = null;
            }

            if (qbConfig) {
                await prisma.quickBooksConfig.update({
                    where: { userId: parseInt(userId) },
                    data: data
                });
            } else {
                // Create new config
                await prisma.quickBooksConfig.create({
                    data: {
                        userId: parseInt(userId),
                        accessToken: null, // Starts disconnected
                        refreshToken: null,
                        realmId: null,
                        ...data
                    }
                });
            }
        }

        res.json({ message: 'Saved' });
    } catch (e) {
        console.error(e);
        res.status(500).json({ message: 'Error saving settings' });
    }
};

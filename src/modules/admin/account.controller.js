const prisma = require('../../config/prisma');

// GET /api/admin/accounts
exports.getAccounts = async (req, res) => {
    try {
        const accounts = await prisma.account.findMany({
            orderBy: { createdAt: 'desc' }
        });
        res.json(accounts);
    } catch (e) {
        console.error('Error fetching accounts:', e);
        res.status(500).json({ message: 'Error fetching accounts' });
    }
};

// POST /api/admin/accounts
exports.createAccount = async (req, res) => {
    try {
        const { accountName, assetType, openingBalance } = req.body;

        const newAccount = await prisma.account.create({
            data: {
                accountName,
                assetType: assetType || 'Asset',
                openingBalance: parseFloat(openingBalance) || 0
            }
        });

        res.status(201).json(newAccount);
    } catch (e) {
        console.error('Error creating account:', e);
        res.status(500).json({ message: 'Error creating account' });
    }
};

// PATCH /api/admin/accounts/:id
exports.updateAccount = async (req, res) => {
    try {
        const { id } = req.params;
        const { accountName, assetType, openingBalance } = req.body;

        const updatedAccount = await prisma.account.update({
            where: { id: parseInt(id) },
            data: {
                accountName,
                assetType,
                openingBalance: openingBalance !== undefined ? parseFloat(openingBalance) : undefined
            }
        });

        res.json(updatedAccount);
    } catch (e) {
        console.error('Error updating account:', e);
        res.status(500).json({ message: 'Error updating account' });
    }
};

// DELETE /api/admin/accounts/:id
exports.deleteAccount = async (req, res) => {
    try {
        const { id } = req.params;
        await prisma.account.delete({
            where: { id: parseInt(id) }
        });
        res.json({ message: 'Account deleted successfully' });
    } catch (e) {
        console.error('Error deleting account:', e);
        res.status(500).json({ message: 'Error deleting account' });
    }
};

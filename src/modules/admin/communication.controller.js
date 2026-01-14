const prisma = require('../../config/prisma');

// GET /api/admin/communication
exports.getHistory = async (req, res) => {
    try {
        const history = await prisma.communication.findMany({
            orderBy: { createdAt: 'desc' }
        });

        const formatted = history.map(item => ({
            id: item.id,
            date: item.createdAt.toISOString().replace('T', ' ').substring(0, 16), // Simple format
            tenant: item.recipient,
            channel: item.type,
            summary: item.subject || item.message.substring(0, 50),
            status: item.status
        }));

        res.json(formatted);
    } catch (e) {
        console.error(e);
        res.status(500).json({ message: 'Server error' });
    }
};

// POST /api/admin/communication
exports.sendMessage = async (req, res) => {
    try {
        const { recipient, subject, message, type } = req.body;

        const newComm = await prisma.communication.create({
            data: {
                recipient, // e.g., "All Tenants", "John Smith"
                subject,
                message,
                type,      // Email, SMS
                status: 'Sent'
            }
        });

        // In a real app, actually send email/SMS here via Twilio/SendGrid

        res.status(201).json(newComm);
    } catch (e) {
        console.error(e);
        res.status(500).json({ message: 'Error sending message' });
    }
};

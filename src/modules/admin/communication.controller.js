const prisma = require('../../config/prisma');

// GET /api/admin/communication
exports.getHistory = async (req, res) => {
    try {
        const history = await prisma.communicationLog.findMany({
            include: { recipientUser: true },
            orderBy: { timestamp: 'desc' }
        });

        const formatted = history.map(item => ({
            id: item.id,
            date: item.timestamp.toISOString().replace('T', ' ').substring(0, 16),
            recipient: item.recipientUser?.name || item.recipient,
            channel: item.channel, // Email/SMS
            eventType: item.eventType,
            summary: item.content?.substring(0, 100) || 'No content',
            status: item.status,
            relatedEntity: item.relatedEntity,
            entityId: item.entityId
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

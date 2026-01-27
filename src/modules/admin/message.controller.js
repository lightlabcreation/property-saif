const prisma = require('../../config/prisma');
const smsService = require('../../services/sms.service');

// GET /api/admin/messages
exports.getMessages = async (req, res) => {
    try {
        const { isRead } = req.query;

        const where = {};
        if (isRead !== undefined) {
            where.isRead = isRead === 'true';
        }

        const messages = await prisma.message.findMany({
            where,
            include: {
                sender: {
                    select: { id: true, name: true, email: true, phone: true, role: true }
                },
                receiver: {
                    select: { id: true, name: true, email: true, phone: true, role: true }
                }
            },
            orderBy: { createdAt: 'desc' }
        });

        const formatted = messages.map(m => ({
            id: m.id,
            content: m.content,
            sender: m.sender,
            receiver: m.receiver,
            isRead: m.isRead,
            createdAt: m.createdAt,
            updatedAt: m.updatedAt
        }));

        res.json(formatted);
    } catch (error) {
        console.error('Error fetching messages:', error);
        res.status(500).json({ message: 'Server error' });
    }
};

// POST /api/admin/messages
exports.sendMessage = async (req, res) => {
    try {
        const { receiverId, content, sendSMS } = req.body;
        const senderId = req.user.id; // Admin user from auth middleware

        if (!receiverId || !content) {
            return res.status(400).json({ message: 'Receiver ID and content are required' });
        }

        // Create message in database
        const message = await prisma.message.create({
            data: {
                senderId: parseInt(senderId),
                receiverId: parseInt(receiverId),
                content
            },
            include: {
                sender: {
                    select: { id: true, name: true, email: true, role: true }
                },
                receiver: {
                    select: { id: true, name: true, email: true, phone: true, role: true }
                }
            }
        });

        // Optionally send SMS notification if requested
        if (sendSMS && message.receiver.phone) {
            try {
                await smsService.sendSMS(message.receiver.phone, content);
                console.log(`SMS sent to ${message.receiver.phone} for message ${message.id}`);
            } catch (smsError) {
                console.error('SMS send failed:', smsError);
                // Don't fail the request if SMS fails
            }
        }

        res.status(201).json(message);
    } catch (error) {
        console.error('Error sending message:', error);
        res.status(500).json({ message: 'Error sending message' });
    }
};

// PUT /api/admin/messages/:id/read
exports.markAsRead = async (req, res) => {
    try {
        const { id } = req.params;

        const updated = await prisma.message.update({
            where: { id: parseInt(id) },
            data: { isRead: true },
            include: {
                sender: {
                    select: { id: true, name: true, email: true, role: true }
                },
                receiver: {
                    select: { id: true, name: true, email: true, role: true }
                }
            }
        });

        res.json(updated);
    } catch (error) {
        console.error('Error marking message as read:', error);
        res.status(500).json({ message: 'Error updating message' });
    }
};

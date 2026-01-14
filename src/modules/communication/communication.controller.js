const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// Send a message
exports.sendMessage = async (req, res) => {
    try {
        const { receiverId, content } = req.body;
        const senderId = req.user.id; // Assumes auth middleware populates req.user

        if (!receiverId || !content) {
            return res.status(400).json({ error: 'Receiver and content are required' });
        }

        const message = await prisma.message.create({
            data: {
                content,
                senderId: parseInt(senderId),
                receiverId: parseInt(receiverId),
                isRead: false
            },
            include: {
                sender: {
                    select: { id: true, name: true, role: true, email: true }
                },
                receiver: {
                    select: { id: true, name: true, role: true, email: true }
                }
            }
        });

        res.status(201).json(message);
    } catch (error) {
        console.error('Error sending message:', error);
        res.status(500).json({ error: 'Failed to send message' });
    }
};

// Get chat history with a specific user
exports.getHistory = async (req, res) => {
    try {
        const currentUserId = req.user.id;
        const otherUserId = parseInt(req.params.userId);

        const messages = await prisma.message.findMany({
            where: {
                OR: [
                    { senderId: currentUserId, receiverId: otherUserId },
                    { senderId: otherUserId, receiverId: currentUserId }
                ]
            },
            orderBy: {
                createdAt: 'asc'
            },
            include: {
                sender: {
                    select: { id: true, name: true, role: true }
                }
            }
        });

        res.json(messages);
    } catch (error) {
        console.error('Error fetching history:', error);
        res.status(500).json({ error: 'Failed to fetch history' });
    }
};

// Get list of conversations (Recent chats + All users depending on role)
exports.getConversations = async (req, res) => {
    try {
        const userId = req.user.id;
        const userRole = req.user.role;

        // For simplicity:
        // If Admin: fetch ALL Tenants and Owners.
        // If Tenant/Owner: fetch ONLY Admin(s).

        if (userRole === 'ADMIN') {
            // Fetch all users except self
            const users = await prisma.user.findMany({
                where: {
                    id: { not: userId },
                    role: { in: ['TENANT', 'OWNER'] }
                },
                select: {
                    id: true,
                    name: true,
                    role: true,
                    email: true,
                    type: true
                }
            });

            // Optionally, attach unread count or last message here if needed
            // For polling simplicity, we might just return the list first
            // Enhancment: Fetch unread counts

            const usersWithMetadata = await Promise.all(users.map(async (u) => {
                const unreadCount = await prisma.message.count({
                    where: {
                        senderId: u.id,
                        receiverId: userId,
                        isRead: false
                    }
                });
                const lastMessage = await prisma.message.findFirst({
                    where: {
                        OR: [
                            { senderId: u.id, receiverId: userId },
                            { senderId: userId, receiverId: u.id }
                        ]
                    },
                    orderBy: { createdAt: 'desc' }
                });
                return { ...u, unreadCount, lastMessage };
            }));

            res.json(usersWithMetadata);

        } else {
            // Find Admins to chat with
            const admins = await prisma.user.findMany({
                where: { role: 'ADMIN' },
                select: { id: true, name: true, role: true }
            });
            res.json(admins);
        }

    } catch (error) {
        console.error('Error fetching conversations:', error);
        res.status(500).json({ error: 'Failed to fetch conversations' });
    }
};

// Mark messages as read
exports.markAsRead = async (req, res) => {
    try {
        const userId = req.user.id;
        const senderId = parseInt(req.body.senderId); // The person whose messages I am reading

        await prisma.message.updateMany({
            where: {
                senderId: senderId, // Message came FROM this person
                receiverId: userId,  // To ME
                isRead: false
            },
            data: { isRead: true }
        });

        res.json({ success: true });
    } catch (error) {
        console.error('Error marking as read:', error);
        res.status(500).json({ error: 'Failed to mark messages as read' });
    }
};

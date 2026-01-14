const prisma = require('../../config/prisma');
const { uploadToCloudinary } = require('../../config/cloudinary');

// GET /api/tenant/tickets
exports.getTickets = async (req, res) => {
    try {
        const userId = req.user.id;
        const tickets = await prisma.ticket.findMany({
            where: { userId },
            orderBy: { createdAt: 'desc' }
        });

        const formatted = tickets.map(t => ({
            id: `T-${t.id + 1000}`,
            subject: t.subject,
            desc: t.description,
            status: t.status,
            priority: t.priority,
            date: t.createdAt.toISOString().split('T')[0],
            attachments: t.attachmentUrls ? JSON.parse(t.attachmentUrls) : []
        }));

        res.json(formatted);
    } catch (e) {
        console.error(e);
        res.status(500).json({ message: 'Server error' });
    }
};

// POST /api/tenant/tickets
exports.createTicket = async (req, res) => {
    try {
        const userId = req.user.id;
        const { subject, desc, description, priority } = req.body;
        const finalDescription = description || desc;

        // Fetch tenant's active lease to get property/unit context
        const activeLease = await prisma.lease.findFirst({
            where: { tenantId: userId, status: 'Active' },
            include: { unit: true }
        });

        const attachmentUrls = [];

        // Handle Images upload
        if (req.files && req.files.images) {
            const images = Array.isArray(req.files.images) ? req.files.images : [req.files.images];
            for (const img of images) {
                const result = await uploadToCloudinary(img.tempFilePath, 'tickets/images');
                attachmentUrls.push({ type: 'image', url: result.secure_url });
            }
        }

        // Handle Video upload
        if (req.files && req.files.video) {
            const video = req.files.video;
            const result = await uploadToCloudinary(video.tempFilePath, 'tickets/videos');
            attachmentUrls.push({ type: 'video', url: result.secure_url });
        }

        const newTicket = await prisma.ticket.create({
            data: {
                userId,
                subject,
                description: finalDescription,
                priority: priority || 'Low',
                status: 'Open',
                propertyId: activeLease?.unit?.propertyId || null,
                unitId: activeLease?.unitId || null,
                attachmentUrls: attachmentUrls.length > 0 ? JSON.stringify(attachmentUrls) : null
            }
        });

        res.status(201).json({
            id: `T-${newTicket.id + 1000}`,
            subject: newTicket.subject,
            desc: finalDescription,
            status: newTicket.status,
            priority: newTicket.priority,
            date: newTicket.createdAt.toISOString().split('T')[0],
            attachments: attachmentUrls
        });

    } catch (e) {
        console.error('Ticket Creation Error:', e);
        res.status(500).json({ message: 'Error creating ticket' });
    }
};

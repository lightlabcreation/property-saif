const prisma = require('../../config/prisma');
const https = require('https');

// GET /api/admin/tickets
exports.getAllTickets = async (req, res) => {
    try {
        const { userId } = req.query;

        const where = {};
        if (userId) {
            where.userId = parseInt(userId);
        }

        const tickets = await prisma.ticket.findMany({
            where,
            include: {
                user: {
                    include: {
                        leases: {
                            where: { status: 'Active' },
                            include: { unit: { include: { property: true } } }
                        }
                    }
                }
            },
            orderBy: { createdAt: 'desc' }
        });

        const formatted = tickets.map(t => {
            // Find active unit for context
            const activeLease = t.user.leases[0];
            const unitInfo = activeLease
                ? `${activeLease.unit.property.name} - ${activeLease.unit.name}`
                : 'No Active Unit';

            return {
                id: `T-${t.id + 1000}`,
                dbId: t.id,
                tenant: t.user.name || 'Unknown',
                unit: unitInfo,
                subject: t.subject,
                category: t.category,
                priority: t.priority,
                status: t.status,
                desc: t.description,
                createdAt: t.createdAt.toLocaleString(),
                date: t.createdAt.toISOString().split('T')[0], // For frontend consistency
                // Attachments
                attachments: t.attachmentUrls ? JSON.parse(t.attachmentUrls).map((att, idx) => ({
                    ...att,
                    proxyUrl: `/api/admin/tickets/${t.id}/attachments/${idx}`
                })) : [],
                tenantDetails: {
                    name: t.user.name,
                    property: activeLease ? activeLease.unit.property.name : 'N/A',
                    unit: activeLease ? activeLease.unit.name : 'N/A',
                    leaseStatus: activeLease ? activeLease.status : 'No Active Lease',
                    email: t.user.email,
                    phone: t.user.phone,
                }
            };
        });

        res.json(formatted);
    } catch (e) {
        console.error(e);
        res.status(500).json({ message: 'Server error' });
    }
};

// PUT /api/admin/tickets/:id/status
exports.updateTicketStatus = async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body;

        // Parse ID (T-1005 -> 5) if needed, but we passed dbId in list
        // If frontend passes "T-1005", we need to split. 
        // Let's assume frontend passes raw int ID or we handle it.
        // Actually the format in list is T-XXXX. Let's rely on receiving INT ID or parsing it.

        // Simpler: frontend sends the numeric ID if we provide it.
        // I provided `dbId` in the response above.

        const ticketId = parseInt(id);

        const updated = await prisma.ticket.update({
            where: { id: ticketId },
            data: { status }
        });

        res.json(updated);
    } catch (e) {
        console.error(e);
        res.status(500).json({ message: 'Server error' });
    }
};

// POST /api/admin/tickets (Admin creating ticket for tenant)
exports.createTicket = async (req, res) => {
    try {
        const { tenantId, subject, description, priority, propertyId, unitId } = req.body;

        // tenantId is user.id
        const newTicket = await prisma.ticket.create({
            data: {
                userId: parseInt(tenantId),
                subject,
                description,
                priority,
                category: req.body.category,
                status: 'Open',
                propertyId: propertyId ? parseInt(propertyId) : null,
                unitId: unitId ? parseInt(unitId) : null
            }
        });

        res.status(201).json(newTicket);
    } catch (e) {
        console.error(e);
        res.status(500).json({ message: 'Error creating ticket' });
    }
};

// GET /api/admin/tickets/:ticketId/attachments/:attachmentId
exports.getTicketAttachment = async (req, res) => {
    try {
        const { ticketId, attachmentId } = req.params;
        const ticket = await prisma.ticket.findUnique({
            where: { id: parseInt(ticketId) }
        });

        if (!ticket || !ticket.attachmentUrls) {
            return res.status(404).json({ message: 'Attachment not found' });
        }

        const attachments = JSON.parse(ticket.attachmentUrls);
        const attachment = attachments[parseInt(attachmentId)];

        if (!attachment || !attachment.url) {
            return res.status(404).json({ message: 'Attachment not found' });
        }

        // Proxy the file from Cloudinary 
        https.get(attachment.url, (response) => {
            if (response.statusCode !== 200) {
                return res.status(response.statusCode).json({ message: 'Failed to fetch attachment from storage' });
            }

            // Trust Cloudinary's content type or guess based on type
            const contentType = response.headers['content-type'] || (attachment.type === 'image' ? 'image/jpeg' : 'application/octet-stream');

            res.setHeader('Content-Type', contentType);
            res.setHeader('Content-Length', response.headers['content-length']);
            // Force inline display for previewable types
            res.setHeader('Content-Disposition', 'inline');

            response.pipe(res);
        }).on('error', (err) => {
            console.error('Attachment Proxy Error:', err);
            res.status(500).json({ message: 'Error proxying attachment' });
        });

    } catch (e) {
        console.error(e);
        res.status(500).json({ message: 'Server error' });
    }
};

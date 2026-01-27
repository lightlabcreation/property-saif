const prisma = require('../../config/prisma');
const smsService = require('../../services/sms.service');
const EmailService = require('../../services/email.service');

// GET /api/admin/communication/emails
exports.getEmailLogs = async (req, res) => {
    try {
        const history = await prisma.communicationLog.findMany({
            where: { channel: 'Email' },
            include: { recipientUser: true },
            orderBy: { timestamp: 'desc' }
        });

        const formatted = history.map(item => ({
            id: item.id,
            date: item.timestamp.toISOString().replace('T', ' ').substring(0, 16),
            recipient: item.recipientUser?.name || item.recipient,
            recipientEmail: item.recipientUser?.email || item.recipient,
            subject: item.content?.split('|')[0]?.replace('Subject:', '').trim() || 'No Subject',
            message: item.content?.split('|')[1]?.replace('Message:', '').trim() || item.content,
            status: item.status
        }));

        res.json(formatted);
    } catch (e) {
        console.error(e);
        res.status(500).json({ message: 'Server error' });
    }
};

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

        let twilioSid = null;
        let twilioSids = [];
        let deliveryStatus = 'Sent';
        let recipientCount = 1;

        // Detect bulk SMS
        const isBulk = type === 'SMS' && (
            recipient.toLowerCase().includes('all tenants') ||
            recipient.toLowerCase().includes('all residents') ||
            Array.isArray(recipient)
        );

        if (type === 'SMS') {
            if (isBulk) {
                // Fetch all tenant phone numbers
                const tenants = await prisma.user.findMany({
                    where: {
                        role: 'TENANT',
                        phone: { not: null }
                    },
                    select: { phone: true, name: true }
                });

                const phoneNumbers = tenants.map(t => t.phone).filter(p => p);
                recipientCount = phoneNumbers.length;

                if (phoneNumbers.length > 0) {
                    console.log(`Sending bulk SMS to ${phoneNumbers.length} recipients...`);
                    const bulkResults = await smsService.sendBulkSMS(phoneNumbers, message);

                    // Collect SIDs and determine overall status
                    twilioSids = bulkResults.filter(r => r.success).map(r => r.sid);
                    const failedCount = bulkResults.filter(r => !r.success).length;

                    if (failedCount === 0) {
                        deliveryStatus = 'Sent';
                    } else if (failedCount === bulkResults.length) {
                        deliveryStatus = 'Failed';
                    } else {
                        deliveryStatus = 'Partial';
                    }

                    // Log each individual send
                    for (const result of bulkResults) {
                        await prisma.communicationLog.create({
                            data: {
                                channel: 'SMS',
                                eventType: 'BULK_MESSAGE',
                                recipient: result.to,
                                content: message,
                                status: result.success ? 'Sent' : 'Failed'
                            }
                        });
                    }
                } else {
                    deliveryStatus = 'Failed';
                    console.error('No tenant phone numbers found for bulk SMS');
                }
            } else {
                // Single SMS
                const smsResult = await smsService.sendSMS(recipient, message);
                if (smsResult.success) {
                    twilioSid = smsResult.sid;
                    deliveryStatus = 'Sent';
                } else {
                    deliveryStatus = 'Failed';
                    console.error('SMS send failed:', smsResult.error);
                }

                // Log single send
                await prisma.communicationLog.create({
                    data: {
                        channel: 'SMS',
                        eventType: 'MANUAL_MESSAGE',
                        recipient: recipient,
                        content: `Subject: ${subject || 'N/A'} | Message: ${message}`,
                        status: deliveryStatus
                    }
                });
            }
        }

        // Handle Email sending
        if (type === 'Email') {
            try {
                // recipient should be an email address
                const emailResult = await EmailService.sendEmail(recipient, subject || 'Message from Admin', message);

                if (emailResult.success) {
                    deliveryStatus = 'Sent';
                    console.log(`Email sent successfully to ${recipient}`);
                } else {
                    deliveryStatus = 'Failed';
                    console.error('Email send failed:', emailResult.error);
                }

                // Log email send (EmailService already logs, but we log here for consistency)
                await prisma.communicationLog.create({
                    data: {
                        channel: 'Email',
                        eventType: 'MANUAL_MESSAGE',
                        recipient: recipient,
                        content: `Subject: ${subject || 'N/A'} | Message: ${message}`,
                        status: deliveryStatus
                    }
                });
            } catch (emailError) {
                deliveryStatus = 'Failed';
                console.error('Email sending error:', emailError);
            }
        }

        const newComm = await prisma.communication.create({
            data: {
                recipient,
                subject,
                message,
                type,
                status: deliveryStatus
            }
        });

        res.status(201).json({
            ...newComm,
            twilioSid,
            twilioSids: twilioSids.length > 0 ? twilioSids : undefined,
            recipientCount
        });
    } catch (e) {
        console.error(e);
        res.status(500).json({ message: 'Error sending message' });
    }
};

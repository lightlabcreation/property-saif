const prisma = require('../../config/prisma');
const smsService = require('../../services/sms.service');
const EmailService = require('../../services/email.service');

// GET /api/admin/communication/emails (paginated, latest first)
exports.getEmailLogs = async (req, res) => {
    try {
        const page = Math.max(1, parseInt(req.query.page, 10) || 1);
        const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 10));
        const skip = (page - 1) * limit;

        const [history, total] = await Promise.all([
            prisma.communicationLog.findMany({
                where: { channel: 'Email' },
                include: { recipientUser: true },
                orderBy: { timestamp: 'desc' },
                skip,
                take: limit
            }),
            prisma.communicationLog.count({ where: { channel: 'Email' } })
        ]);

        const formatted = history.map(item => {
            const subjectPart = item.content?.split('|')[0];
            const bodyPart = item.content?.split('|')[1];
            const subject = subjectPart?.replace(/^Subject:\s*/i, '').trim() || (bodyPart ? 'No Subject' : 'No Subject');
            const message = bodyPart?.replace(/^Message:\s*/i, '').trim() || bodyPart?.replace(/^Body:\s*/i, '').trim() || item.content;
            const source = (item.eventType === 'MANUAL_EMAIL' || item.eventType === 'MANUAL_MESSAGE') ? 'Manual' : 'System';
            return {
                id: item.id,
                date: item.timestamp.toISOString().replace('T', ' ').substring(0, 16),
                recipient: item.recipientUser?.name || item.recipient,
                recipientEmail: item.recipientUser?.email || item.recipient,
                subject,
                message,
                status: item.status,
                source
            };
        });

        res.json({
            data: formatted,
            total,
            page,
            limit,
            totalPages: Math.ceil(total / limit)
        });
    } catch (e) {
        console.error(e);
        res.status(500).json({ message: 'Server error' });
    }
};

// DELETE /api/admin/communication/emails/:id
exports.deleteEmailLog = async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        if (isNaN(id)) {
            return res.status(400).json({ message: 'Invalid log ID' });
        }
        const deleted = await prisma.communicationLog.deleteMany({
            where: { id, channel: 'Email' }
        });
        if (deleted.count === 0) {
            return res.status(404).json({ message: 'Email log not found' });
        }
        res.json({ success: true, message: 'Log deleted' });
    } catch (e) {
        console.error(e);
        res.status(500).json({ message: 'Failed to delete log' });
    }
};

// POST /api/admin/communication/send-email (manual compose & send – uses existing SendGrid, logs to same Email Logs)
exports.sendComposeEmail = async (req, res) => {
    try {
        const { recipients, subject, body } = req.body;

        const errors = [];
        if (!recipients || (Array.isArray(recipients) && recipients.length === 0)) {
            errors.push('At least one recipient is required.');
        }
        if (!subject || typeof subject !== 'string' || !subject.trim()) {
            errors.push('Subject is required.');
        }
        if (body == null || typeof body !== 'string' || !body.trim()) {
            errors.push('Message body is required.');
        }

        const emailList = Array.isArray(recipients)
            ? recipients.map(r => (typeof r === 'string' ? r.trim() : '')).filter(Boolean)
            : (typeof recipients === 'string' ? recipients.split(/[\s,;]+/).map(s => s.trim()).filter(Boolean) : []);

        if (emailList.length === 0 && errors.length === 0) {
            errors.push('At least one valid recipient email is required.');
        }

        if (errors.length > 0) {
            return res.status(400).json({ success: false, message: errors.join(' '), errors });
        }

        const results = [];
        let successCount = 0;
        let failCount = 0;

        for (const to of emailList) {
            const emailResult = await EmailService.sendEmail(to.trim(), subject.trim(), body.trim(), { eventType: 'MANUAL_EMAIL' });
            if (emailResult.success) {
                successCount++;
                results.push({ to, success: true });
            } else {
                failCount++;
                results.push({ to, success: false, error: emailResult.error || 'Send failed' });
            }
        }

        if (failCount === emailList.length) {
            return res.status(502).json({
                success: false,
                message: 'No emails could be sent. Please check your configuration and try again.',
                results
            });
        }

        res.status(201).json({
            success: true,
            message: successCount === emailList.length
                ? `Email sent successfully to ${successCount} recipient(s).`
                : `Sent to ${successCount} recipient(s). ${failCount} failed.`,
            sent: successCount,
            failed: failCount,
            results
        });
    } catch (e) {
        console.error(e);
        res.status(500).json({ success: false, message: 'Failed to send email.' });
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

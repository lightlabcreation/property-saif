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
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const skip = (page - 1) * limit;

        const [history, total] = await Promise.all([
            prisma.communicationLog.findMany({
                include: {
                    recipientUser: {
                        select: {
                            name: true,
                            firstName: true,
                            lastName: true,
                            email: true,
                            phone: true
                        }
                    }
                },
                orderBy: { timestamp: 'desc' },
                skip,
                take: limit
            }),
            prisma.communicationLog.count()
        ]);

        // Resolve names for phone numbers/emails
        const formatted = await Promise.all(history.map(async (item) => {
            let recipientDisplay = item.recipient;

            // 1. If we have a connected user, use their name
            if (item.recipientUser) {
                const user = item.recipientUser;
                recipientDisplay = user.name || `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.email || user.phone || item.recipient;
            }
            // 2. If no connected user, but recipient looks like a phone, search by phone
            else if (item.recipient && (item.recipient.startsWith('+') || /^\d{10,15}$/.test(item.recipient.replace(/\D/g, '')))) {
                const user = await prisma.user.findFirst({
                    where: { phone: item.recipient },
                    select: { name: true, firstName: true, lastName: true }
                });
                if (user) {
                    recipientDisplay = user.name || `${user.firstName || ''} ${user.lastName || ''}`.trim();
                }
            }
            // 3. If no connected user, but recipient looks like an email, search by email
            else if (item.recipient && item.recipient.includes('@')) {
                const user = await prisma.user.findFirst({
                    where: { email: item.recipient },
                    select: { name: true, firstName: true, lastName: true }
                });
                if (user) {
                    recipientDisplay = user.name || `${user.firstName || ''} ${user.lastName || ''}`.trim();
                }
            }

            return {
                id: item.id,
                date: item.timestamp.toISOString().replace('T', ' ').substring(0, 16),
                recipient: recipientDisplay,
                eventType: item.eventType,
                summary: item.content?.substring(0, 100) || 'No content'
            };
        }));

        res.json({
            logs: formatted,
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit)
            }
        });
    } catch (e) {
        console.error(e);
        res.status(500).json({ message: 'Server error' });
    }
};

// DELETE /api/admin/communication/:id
exports.deleteLog = async (req, res) => {
    try {
        await prisma.communicationLog.delete({
            where: { id: parseInt(req.params.id) }
        });
        res.json({ success: true });
    } catch (e) {
        console.error(e);
        res.status(500).json({ message: 'Failed to delete log' });
    }
};

// POST /api/admin/communication/bulk-delete
exports.bulkDeleteLogs = async (req, res) => {
    try {
        const { ids } = req.body;
        await prisma.communicationLog.deleteMany({
            where: { id: { in: ids } }
        });
        res.json({ success: true, deleted: ids.length });
    } catch (e) {
        console.error(e);
        res.status(500).json({ message: 'Failed to delete logs' });
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
            (typeof recipient === 'string' && (
                recipient.toLowerCase().includes('all tenants') ||
                recipient.toLowerCase().includes('all residents') ||
                recipient.toLowerCase().includes('all owners')
            )) ||
            Array.isArray(recipient)
        );

        if (type === 'SMS') {
            if (isBulk) {
                let users = [];

                // Determine which users to fetch
                if (Array.isArray(recipient)) {
                    // Custom selection: fetch specific users by IDs
                    users = await prisma.user.findMany({
                        where: {
                            id: { in: recipient },
                            phone: { not: null }
                        },
                        select: { id: true, phone: true, name: true }
                    });
                } else if (recipient.toLowerCase().includes('all tenants')) {
                    // All tenants
                    users = await prisma.user.findMany({
                        where: {
                            role: 'TENANT',
                            type: { not: 'RESIDENT' },
                            phone: { not: null }
                        },
                        select: { id: true, phone: true, name: true }
                    });
                } else if (recipient.toLowerCase().includes('all residents')) {
                    // All residents
                    users = await prisma.user.findMany({
                        where: {
                            type: 'RESIDENT',
                            phone: { not: null }
                        },
                        select: { id: true, phone: true, name: true }
                    });
                } else if (recipient.toLowerCase().includes('all owners')) {
                    // All owners
                    users = await prisma.user.findMany({
                        where: {
                            role: 'OWNER',
                            phone: { not: null }
                        },
                        select: { id: true, phone: true, name: true }
                    });
                }

                const phoneNumbers = users.map(u => u.phone).filter(p => p);
                recipientCount = phoneNumbers.length;

                // The following code block was provided in the instruction, but contains undefined variables
                // (targetNumericId, userId, unreadCount) and a malformed return statement (}));).
                // It also appears to be out of context for this specific function's logic (sending bulk SMS).
                // To avoid introducing syntax errors or logical inconsistencies, this block is commented out.
                // If this is intended for a different part of the code or requires context, please clarify.
                /*
                const lastMessage = await prisma.message.findFirst({
                    where: {
                        OR: [
                            { senderId: targetNumericId, receiverId: userId },
                            { senderId: userId, receiverId: targetNumericId }
                        ]
                    },
                    orderBy: { createdAt: 'desc' }
                });
                return { ...recipient, unreadCount, lastMessage };
                }));
                */
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

                    // Log each individual send AND create chat message
                    for (let i = 0; i < bulkResults.length; i++) {
                        const result = bulkResults[i];
                        const user = users[i]; // Get the corresponding user

                        // Create communication log
                        await prisma.communicationLog.create({
                            data: {
                                channel: 'SMS',
                                eventType: 'BULK_MESSAGE',
                                recipient: result.to,
                                content: message,
                                status: result.success ? 'Sent' : 'Failed'
                            }
                        });

                        // Create individual message in chat history (if user has an ID)
                        if (user && user.id) {
                            try {
                                await prisma.message.create({
                                    data: {
                                        content: message,
                                        senderId: req.user?.id || 1, // Admin ID
                                        receiverId: user.id,
                                        isRead: false,
                                        smsSid: result.sid || null,
                                        smsStatus: result.success ? 'sent' : 'failed',
                                        sentVia: 'sms'
                                    }
                                });
                            } catch (msgError) {
                                console.error(`Failed to create message for user ${user.id}:`, msgError);
                            }
                        }
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

        // Convert recipient to string if it's an array (for database storage)
        const recipientString = Array.isArray(recipient)
            ? `Custom Selection (${recipient.length} recipients)`
            : recipient;

        const newComm = await prisma.communication.create({
            data: {
                recipient: recipientString,
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

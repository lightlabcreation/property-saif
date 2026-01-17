const prisma = require('../config/prisma');

/**
 * CommunicationService
 * Handles sending (mocking) and logging of Emails and SMS
 */
class CommunicationService {
    static templates = {
        'TENANT_INVITE': {
            subject: 'Welcome to {{propertyName}}!',
            body: 'Hello {{tenantName}}, you are invited to join the portal for {{unitName}}.'
        },
        'INVOICE_GENERATED': {
            subject: 'New Invoice Generated - {{month}}',
            body: 'Hello {{tenantName}}, your invoice for {{month}} has been generated. Amount: ${{invoiceAmount}}. Due Date: {{dueDate}}.'
        },
        'PAYMENT_SUCCESSFUL': {
            subject: 'Payment Confirmation',
            body: 'Hello {{tenantName}}, we have received your payment of ${{invoiceAmount}} for {{unitName}}.'
        },
        'INSURANCE_EXPIRING': {
            subject: 'ACTION REQUIRED: Insurance Expiring Soon',
            body: 'Hello {{tenantName}}, your insurance policy for {{unitName}} is set to expire on {{endDate}}. Please upload a new policy.'
        },
        'INSURANCE_EXPIRED': {
            subject: 'URGENT: Insurance Expired',
            body: 'Hello {{tenantName}}, your insurance policy has expired. Please upload valid coverage immediately.'
        },
        'INSURANCE_APPROVED': {
            subject: 'Insurance Approved',
            body: 'Hello {{tenantName}}, your insurance policy for {{unitName}} has been approved.'
        },
        'INSURANCE_REJECTED': {
            subject: 'Insurance Rejected',
            body: 'Hello {{tenantName}}, your insurance policy was rejected. Reason: {{rejectionReason}}.'
        }
    };

    /**
     * Send an automated notification
     * @param {Object} params 
     */
    static async sendNotification({
        templateKey,
        recipientId,
        recipientAddress,
        variables = {},
        channel = 'Email',
        relatedEntity = null,
        entityId = null
    }) {
        try {
            const template = this.templates[templateKey];
            if (!template) throw new Error(`Template ${templateKey} not found`);

            let subject = template.subject;
            let body = template.body;

            // Replace variables
            Object.keys(variables).forEach(key => {
                const regex = new RegExp(`{{${key}}}`, 'g');
                subject = subject.replace(regex, variables[key] || '');
                body = body.replace(regex, variables[key] || '');
            });

            // LOG to CommunicationLog
            const log = await prisma.communicationLog.create({
                data: {
                    channel,
                    eventType: templateKey,
                    recipient: recipientAddress,
                    recipientId: recipientId,
                    relatedEntity,
                    entityId,
                    content: `Subject: ${subject} | Body: ${body}`,
                    status: 'Sent' // Mocked as Sent
                }
            });

            // TODO: Integrate with real SendGrid/Twilio if keys provided
            console.log(`[CommunicationService] ${channel} sent to ${recipientAddress}: ${subject}`);

            return log;
        } catch (e) {
            console.error('[CommunicationService] Error:', e);
            throw e;
        }
    }
}

module.exports = CommunicationService;

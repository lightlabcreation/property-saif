const prisma = require('../config/prisma');

/**
 * Service to handle all outgoing communications (Email/SMS)
 * and log them to the CommunicationLog table for audit purposes.
 */
class CommunicationService {

    /**
     * Send a general notification and log it
     */
    async logCommunication({ recipientId, recipientEmail, eventType, channel, content, relatedEntity, entityId }) {
        try {
            const log = await prisma.communicationLog.create({
                data: {
                    recipientId: recipientId || null,
                    recipient: recipientEmail,
                    eventType,
                    channel,
                    content,
                    relatedEntity,
                    entityId,
                    status: 'Sent', // In a real app, this would be 'Pending' then updated after actual dispatch
                }
            });

            // REAL-WORLD DISPATCH LOGIC (e.g. SendGrid or Twilio)
            // console.log(`[DISPATCH] Sending ${channel} to ${recipientEmail}: ${content}`);

            return log;
        } catch (error) {
            console.error('Failed to log communication:', error);
            throw error;
        }
    }

    /**
     * Notify tenant of Insurance Approval
     */
    async sendInsuranceApproved(userId, insuranceId) {
        const user = await prisma.user.findUnique({ where: { id: userId } });
        if (!user) return;

        const content = `Your insurance policy (ID: ${insuranceId}) has been approved. Your status is now ACTIVE.`;

        return this.logCommunication({
            recipientId: userId,
            recipientEmail: user.email,
            eventType: 'INSURANCE_APPROVED',
            channel: 'Email',
            content,
            relatedEntity: 'INSURANCE',
            entityId: insuranceId
        });
    }

    /**
     * Notify tenant of Insurance Rejection
     */
    async sendInsuranceRejected(userId, insuranceId, reason) {
        const user = await prisma.user.findUnique({ where: { id: userId } });
        if (!user) return;

        const content = `Your insurance policy (ID: ${insuranceId}) was rejected. Reason: ${reason}. Please upload a corrected document.`;

        return this.logCommunication({
            recipientId: userId,
            recipientEmail: user.email,
            eventType: 'INSURANCE_REJECTED',
            channel: 'Email',
            content,
            relatedEntity: 'INSURANCE',
            entityId: insuranceId
        });
    }

    /**
     * Notify tenant of Insurance Expiry
     */
    async sendInsuranceExpiryAlert(userId, insuranceId, daysRemaining) {
        const user = await prisma.user.findUnique({ where: { id: userId } });
        if (!user) return;

        const content = `Your insurance policy (ID: ${insuranceId}) expires in ${daysRemaining} days. Please upload a new policy to remain compliant.`;

        return this.logCommunication({
            recipientId: userId,
            recipientEmail: user.email,
            eventType: `INSURANCE_EXPIRY_${daysRemaining}`,
            channel: 'Email',
            content,
            relatedEntity: 'INSURANCE',
            entityId: insuranceId
        });
    }
}

module.exports = new CommunicationService();

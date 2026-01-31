const axios = require('axios');
const prisma = require('../config/prisma');

/**
 * Email Service
 * Handles sending emails via SendGrid REST API
 */
class EmailService {
    /**
     * Send an email using SendGrid
     * @param {string} to - Recipient email address
     * @param {string} subject - Email subject
     * @param {string} text - Email body (plain text)
     * @param {object} [options] - Optional. { eventType } for log entry (default: TENANT_CREATION_CREDENTIALS)
     * @returns {Promise<object>} - SendGrid response or error
     */
    static async sendEmail(to, subject, text, options = {}) {
        const eventType = options.eventType || 'TENANT_CREATION_CREDENTIALS';
        if (!process.env.SENDGRID_API_KEY) {
            console.error('[EmailService] SENDGRID_API_KEY is not defined in .env');
            return { success: false, error: 'API Key missing' };
        }

        try {
            // Fetch sender name from SystemSettings if exists
            const settings = await prisma.systemSetting.findMany({
                where: {
                    key: 'EMAIL_SENDER_NAME'
                }
            });

            const senderName = settings.length > 0 ? settings[0].value : 'Campus Habitations';
            const fromEmail = process.env.SENDGRID_SENDER_EMAIL || 'Administration@campushabitations.com';

            console.log(`[EmailService] Attempting to send email to ${to}...`);

            const data = {
                personalizations: [{
                    to: [{ email: to }]
                }],
                from: {
                    email: fromEmail,
                    name: senderName
                },
                subject: subject,
                content: [{
                    type: 'text/plain',
                    value: text
                }]
            };

            const response = await axios.post('https://api.sendgrid.com/v3/mail/send', data, {
                headers: {
                    'Authorization': `Bearer ${process.env.SENDGRID_API_KEY}`,
                    'Content-Type': 'application/json'
                }
            });

            console.log(`[EmailService] Email sent successfully to ${to}. Status: ${response.status}`);

            // Log to CommunicationLog if possible (optional but good for consistency)
            try {
                await prisma.communicationLog.create({
                    data: {
                        channel: 'Email',
                        eventType,
                        recipient: to,
                        content: `Subject: ${subject} | Body: ${text}`,
                        status: 'Sent'
                    }
                });
            } catch (logError) {
                console.error('[EmailService] Error logging communication:', logError.message);
            }

            return { success: true, status: response.status };
        } catch (error) {
            const errorMessage = error.response ? JSON.stringify(error.response.data) : error.message;
            console.error(`[EmailService] Error sending email to ${to}:`, errorMessage);

            try {
                await prisma.communicationLog.create({
                    data: {
                        channel: 'Email',
                        eventType,
                        recipient: to,
                        content: `Subject: ${subject} | Body: ${text}`,
                        status: 'Failed',
                        timestamp: new Date()
                    }
                });
            } catch (logError) {
                // ignore
            }

            return { success: false, error: errorMessage };
        }
    }
}

module.exports = EmailService;

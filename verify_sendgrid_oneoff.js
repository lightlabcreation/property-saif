require('dotenv').config();
const axios = require('axios');
const prisma = require('./src/config/prisma');

async function sendOneOffEmail() {
    console.log('--- One-off SendGrid Verification ---');
    const to = '';
    const subject = 'SendGrid Verification - Property Management';
    const text = 'Hello, this is a test email to verify that the SendGrid integration is working correctly for your account.';

    const apiKey = process.env.SENDGRID_API_KEY;
    const fromEmail = process.env.SENDGRID_SENDER_EMAIL || 'Administration@campushabitations.com';

    try {
        // Fetch sender name from SystemSettings if exists (mimicking service logic)
        const settings = await prisma.systemSetting.findMany({
            where: { key: 'EMAIL_SENDER_NAME' }
        });
        const senderName = settings.length > 0 ? settings[0].value : 'Campus Habitations';

        const data = {
            personalizations: [{ to: [{ email: to }] }],
            from: { email: fromEmail, name: senderName },
            subject: subject,
            content: [{ type: 'text/plain', value: text }]
        };

        const response = await axios.post('https://api.sendgrid.com/v3/mail/send', data, {
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            }
        });

        console.log(`SUCCESS: Email sent to ${to}. Status: ${response.status}`);
    } catch (error) {
        const errorMessage = error.response ? JSON.stringify(error.response.data) : error.message;
        console.error(`FAILURE: Error sending email to ${to}:`, errorMessage);
    }
    process.exit(0);
}

sendOneOffEmail();

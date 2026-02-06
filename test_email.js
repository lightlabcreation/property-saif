require('dotenv').config();
const emailService = require('./src/services/email.service');

async function testEmail() {
    console.log('--- SendGrid Email Integration Test ---');
    console.log('Using API Key:', process.env.SENDGRID_API_KEY ? 'Present (Hidden)' : 'MISSING');
    console.log('Using Sender:', process.env.SENDGRID_SENDER_EMAIL);

    const testRecipient = ''; // Testing by sending to oneself or a verified address
    const subject = 'Test Email from Property Management System';
    const text = 'This is a test email to verify the SendGrid integration. If you receive this, the integration is working correctly.';

    try {
        const result = await emailService.sendEmail(testRecipient, subject, text);
        if (result.success) {
            console.log('SUCCESS: Email sent successfully.');
        } else {
            console.error('FAILURE: Email sending failed.', result.error);
        }
    } catch (error) {
        console.error('ERROR: An unexpected error occurred during testing.', error);
    }
}

testEmail();

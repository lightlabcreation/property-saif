const twilio = require("twilio");

// Twilio Credentials
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_PHONE_NUMBER = process.env.TWILIO_PHONE_NUMBER;

// Initialize Twilio client
let client;
try {
    client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
} catch (error) {
    console.error("Error initializing Twilio client:", error);
}

/**
 * Helper to ensure E.164 format for US/Canada
 * @param {string} phone 
 * @returns {string} E.164 formatted phone number
 */
const normalizePhoneNumber = (phone) => {
    if (!phone) return phone;

    // 1. Remove all non-numeric characters (parentheses, dashes, spaces)
    const digits = phone.replace(/\D/g, '');

    // 2. Format based on length
    // If 10 digits (e.g. 4165551234), add +1 -> +14165551234
    if (digits.length === 10) {
        return `+1${digits}`;
    }
    // If 11 digits starting with 1 (e.g. 14165551234), add + -> +14165551234
    if (digits.length === 11 && digits.startsWith('1')) {
        return `+${digits}`;
    }

    // Otherwise return original (assumed already correct or international) - ensure it has + if seemingly valid
    return phone.startsWith('+') ? phone : `+${phone}`;
};

/**
 * Send SMS to a phone number
 * @param {string} to - The recipient's phone number (E.164 format e.g., +15550001111)
 * @param {string} message - The message content
 * @returns {Promise<object>} - Twilio message object or error
 */
exports.sendSMS = async (to, message) => {
    if (!client) {
        console.error("Twilio client not initialized");
        return { success: false, message: "Twilio client not initialized" };
    }

    try {
        const formattedTo = normalizePhoneNumber(to);
        console.log(`Sending SMS to ${formattedTo}...`);

        const result = await client.messages.create({
            body: message,
            from: TWILIO_PHONE_NUMBER,
            to: formattedTo,
        });
        console.log(`SMS sent successfully to ${formattedTo}. SID: ${result.sid}`);
        return { success: true, sid: result.sid, result };
    } catch (error) {
        console.error(`Error sending SMS to ${to}:`, error);
        return { success: false, error: error.message, code: error.code };
    }
};

/**
 * Send SMS to multiple phone numbers (bulk)
 * @param {Array<string>} recipients - Array of phone numbers (E.164 format)
 * @param {string} message - The message content
 * @returns {Promise<Array>} - Array of results for each recipient
 */
exports.sendBulkSMS = async (recipients, message) => {
    if (!client) {
        console.error("Twilio client not initialized");
        return recipients.map(to => ({ to, success: false, message: "Twilio client not initialized" }));
    }

    const results = [];

    for (let i = 0; i < recipients.length; i++) {
        const originalTo = recipients[i];
        const formattedTo = normalizePhoneNumber(originalTo);

        try {
            console.log(`Sending bulk SMS ${i + 1}/${recipients.length} to ${formattedTo}...`);
            const result = await client.messages.create({
                body: message,
                from: TWILIO_PHONE_NUMBER,
                to: formattedTo,
            });
            console.log(`SMS sent successfully to ${formattedTo}. SID: ${result.sid}`);
            results.push({ to: originalTo, success: true, sid: result.sid });
        } catch (error) {
            console.error(`Error sending SMS to ${formattedTo}:`, error);
            results.push({ to: originalTo, success: false, error: error.message, code: error.code });
        }

        // Throttle: Wait 1 second between sends to respect Twilio rate limits
        if (i < recipients.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
    }

    return results;
};
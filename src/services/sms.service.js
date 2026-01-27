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
        console.log(`Sending SMS to ${to}...`);
        const result = await client.messages.create({
            body: message,
            from: TWILIO_PHONE_NUMBER,
            to,
        });
        console.log(`SMS sent successfully to ${to}. SID: ${result.sid}`);
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
        const to = recipients[i];

        try {
            console.log(`Sending bulk SMS ${i + 1}/${recipients.length} to ${to}...`);
            const result = await client.messages.create({
                body: message,
                from: TWILIO_PHONE_NUMBER,
                to,
            });
            console.log(`SMS sent successfully to ${to}. SID: ${result.sid}`);
            results.push({ to, success: true, sid: result.sid });
        } catch (error) {
            console.error(`Error sending SMS to ${to}:`, error);
            results.push({ to, success: false, error: error.message, code: error.code });
        }

        // Throttle: Wait 1 second between sends to respect Twilio rate limits
        if (i < recipients.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
    }

    return results;
};
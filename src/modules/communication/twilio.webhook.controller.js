const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

/**
 * Twilio Webhook Handler for Incoming SMS
 * This endpoint receives incoming SMS messages from Twilio and creates them in the database
 */
exports.handleIncomingSMS = async (req, res) => {
    try {
        const { From, To, Body, MessageSid } = req.body;

        console.log('📱 Incoming SMS from Twilio:', { From, To, Body, MessageSid });

        // Find the user by phone number (sender)
        const sender = await prisma.user.findFirst({
            where: {
                phone: {
                    contains: From.replace(/\D/g, '').slice(-10) // Match last 10 digits
                }
            }
        });

        if (!sender) {
            console.warn(`⚠️ No user found with phone number: ${From}`);
            // Send TwiML response
            res.set('Content-Type', 'text/xml');
            return res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Message>Sorry, we couldn't identify your account. Please contact support.</Message>
</Response>`);
        }

        // Find admin user to receive the message
        const admin = await prisma.user.findFirst({
            where: { role: 'ADMIN' }
        });

        if (!admin) {
            console.error('❌ No admin user found to receive SMS');
            res.set('Content-Type', 'text/xml');
            return res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Message>System error. Please try again later.</Message>
</Response>`);
        }

        // Create message in database
        const message = await prisma.message.create({
            data: {
                content: Body,
                senderId: sender.id,
                receiverId: admin.id,
                isRead: false,
                smsSid: MessageSid,
                smsStatus: 'received',
                sentVia: 'sms'
            }
        });

        console.log(`✅ SMS message saved to database (ID: ${message.id})`);

        // Send TwiML response (optional auto-reply)
        res.set('Content-Type', 'text/xml');
        res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Message>Message received. We'll get back to you soon!</Message>
</Response>`);

    } catch (error) {
        console.error('❌ Error handling incoming SMS:', error);
        res.set('Content-Type', 'text/xml');
        res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Message>Error processing your message. Please try again.</Message>
</Response>`);
    }
};

/**
 * Twilio Status Callback Handler
 * Updates SMS delivery status in the database
 */
exports.handleSMSStatusCallback = async (req, res) => {
    try {
        const { MessageSid, MessageStatus } = req.body;

        console.log('📊 SMS Status Update:', { MessageSid, MessageStatus });

        // Update message status in database
        const updated = await prisma.message.updateMany({
            where: { smsSid: MessageSid },
            data: { smsStatus: MessageStatus }
        });

        console.log(`✅ Updated ${updated.count} message(s) with status: ${MessageStatus}`);

        res.sendStatus(200);
    } catch (error) {
        console.error('❌ Error handling SMS status callback:', error);
        res.sendStatus(500);
    }
};

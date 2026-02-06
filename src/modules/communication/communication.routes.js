const express = require('express');

const router = express.Router();
const communicationController = require('./communication.controller');
const twilioWebhookController = require('./twilio.webhook.controller');
const { authenticate } = require('../../middlewares/auth.middleware'); // Corrected path

// Twilio webhook routes (NO AUTH - Twilio needs to access these)
router.post('/webhook/sms/incoming', twilioWebhookController.handleIncomingSMS);
router.post('/webhook/sms/status', twilioWebhookController.handleSMSStatusCallback);

// Authenticated routes
router.use(authenticate);

router.post('/send', communicationController.sendMessage);
router.get('/history/:userId', communicationController.getHistory);
router.get('/conversations', communicationController.getConversations);
router.post('/mark-read', communicationController.markAsRead);

module.exports = router;

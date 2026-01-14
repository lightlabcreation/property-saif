const express = require('express');

const router = express.Router();
const communicationController = require('./communication.controller');
const { authenticate } = require('../../middlewares/auth.middleware'); // Corrected path

// Helper to ensure auth is applied
router.use(authenticate);

router.post('/send', communicationController.sendMessage);
router.get('/history/:userId', communicationController.getHistory);
router.get('/conversations', communicationController.getConversations);
router.post('/mark-read', communicationController.markAsRead);

module.exports = router;

const express = require('express');
const router = express.Router();
const authController = require('./auth.controller');

router.post('/login', authController.validateLogin, authController.login);
router.get('/invite/:token', authController.getInviteDetails);
router.post('/accept-invite', authController.acceptInvite);

module.exports = router;

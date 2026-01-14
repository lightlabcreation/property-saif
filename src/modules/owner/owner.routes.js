const express = require('express');
const router = express.Router();
const ownerController = require('./owner.controller');
const { authenticate, authorize } = require('../../middlewares/auth.middleware');

// Protect all owner routes
router.use(authenticate);
router.use(authorize('OWNER'));

// const financialController = require('./financial.controller'); removed

router.get('/dashboard/stats', ownerController.getOwnerDashboardStats);
router.get('/dashboard/financial-pulse', ownerController.getOwnerFinancialPulse);
router.get('/properties', ownerController.getOwnerProperties);
router.get('/financials', ownerController.getOwnerFinancials);
router.get('/reports', ownerController.getOwnerReports);

module.exports = router;

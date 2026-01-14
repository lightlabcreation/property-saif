const express = require('express');
const router = express.Router();

// Import module routes
const authRoutes = require('./modules/auth/auth.routes');
const adminRoutes = require('./modules/admin/admin.routes');
const tenantRoutes = require('./modules/admin/tenant.routes');
const leaseRoutes = require('./modules/admin/lease.routes');
const unitRoutes = require('./modules/admin/unit.routes');
// const ownerRoutes = require('./modules/owner/owner.routes');
// const tenantRoutes = require('./modules/tenant/tenant.routes');

// Health Check
router.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date() });
});

const ownerRoutes = require('./modules/owner/owner.routes');

const tenantPortalRoutes = require('./modules/tenant/tenant.portal.routes');

router.use('/auth', authRoutes);
router.use('/admin/tenants', tenantRoutes);
router.use('/admin/leases', leaseRoutes);
router.use('/admin/units', unitRoutes);
router.use('/admin', adminRoutes);
router.use('/owner', ownerRoutes);
router.use('/tenant', tenantPortalRoutes);
router.use('/communication', require('./modules/communication/communication.routes'));

module.exports = router;

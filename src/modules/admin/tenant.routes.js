const express = require('express');
const router = express.Router();
const tenantController = require('./tenant.controller');

router.get('/', tenantController.getAllTenants);
router.get('/:id', tenantController.getTenantById);
router.get('/:id/tickets', tenantController.getTenantTickets);
router.post('/', tenantController.createTenant);
router.put('/:id', tenantController.updateTenant);
router.delete('/:id', tenantController.deleteTenant);

module.exports = router;

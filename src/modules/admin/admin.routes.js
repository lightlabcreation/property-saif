const express = require('express');
const router = express.Router();
const adminController = require('./admin.controller');
// const { authenticate, authorize } = require('../../middlewares/authMiddleware');

// Protected Routes (Commented out middleware for initial testing until frontend sends token)
// router.use(authenticate); 
// router.use(authorize('ADMIN'));

const ticketController = require('./ticket.controller');

router.get('/dashboard/stats', adminController.getDashboardStats);
router.get('/properties', adminController.getProperties);

const invoiceController = require('./invoice.controller');
const maintenanceController = require('./maintenance.controller');
const accountingController = require('./accounting.controller');
const communicationController = require('./communication.controller');
const analyticsController = require('./analytics.controller');
const leaseController = require('./lease.controller');
const insuranceController = require('./insurance.controller');
const reportsController = require('./reports.controller');
const settingsController = require('./settings.controller');
const taxController = require('./tax.controller');
const accountController = require('./account.controller');

router.get('/dashboard/stats', adminController.getDashboardStats);
router.get('/owners', adminController.getOwners);
router.post('/owners', adminController.createOwner);
router.put('/owners/:id', adminController.updateOwner);
router.delete('/owners/:id', adminController.deleteOwner);
router.get('/properties', adminController.getProperties);
router.post('/properties', adminController.createProperty);
router.put('/properties/:id', adminController.updateProperty);
router.delete('/properties/:id', adminController.deleteProperty);
router.get('/properties/:id', adminController.getPropertyDetails);

router.get('/tickets', ticketController.getAllTickets);
router.post('/tickets', ticketController.createTicket);
router.put('/tickets/:id/status', ticketController.updateTicketStatus);
router.get('/tickets/:ticketId/attachments/:attachmentId', ticketController.getTicketAttachment);

router.get('/invoices', invoiceController.getInvoices);
router.post('/invoices', invoiceController.createInvoice);
router.put('/invoices/:id', invoiceController.updateInvoice);
router.delete('/invoices/:id', invoiceController.deleteInvoice);
router.get('/invoices/:id/download', invoiceController.downloadInvoicePDF);

const paymentController = require('./payment.controller');
router.get('/payments', paymentController.getReceivedPayments);
router.get('/outstanding-dues', paymentController.getOutstandingDues);
router.get('/payments/:id/download', paymentController.downloadReceiptPDF);

const refundController = require('./refund.controller');
router.get('/refunds', refundController.getRefunds);
router.post('/refunds', refundController.createRefund);
router.put('/refunds/:id', refundController.updateRefund);
router.delete('/refunds/:id', refundController.deleteRefund);

router.get('/leases', leaseController.getLeaseHistory);
router.delete('/leases/:id', leaseController.deleteLease);
router.put('/leases/:id', leaseController.updateLease);
router.get('/leases/:id/download', leaseController.downloadLeasePDF);

router.get('/insurance/alerts', insuranceController.getInsuranceAlerts);

router.get('/maintenance', maintenanceController.getTasks);
router.post('/maintenance', maintenanceController.createTask);
router.put('/maintenance/:id', maintenanceController.updateTask);

router.get('/accounting/transactions', accountingController.getTransactions);
router.post('/accounting/transactions', accountingController.createTransaction);

router.get('/communication', communicationController.getHistory);
router.post('/communication', communicationController.sendMessage);

router.get('/analytics/revenue', analyticsController.getRevenueStats);
router.get('/analytics/vacancy', analyticsController.getVacancyStats);
router.get('/reports', reportsController.getReports);
router.get('/reports/:id/download', reportsController.downloadReportPDF);

router.get('/settings', settingsController.getSettings);
router.post('/settings', settingsController.updateSettings);

router.get('/taxes', taxController.getTaxes);
router.post('/taxes', taxController.updateTaxes);
router.patch('/taxes/:id', taxController.updateTax);
router.delete('/taxes/:id', taxController.deleteTax);

router.get('/accounts', accountController.getAccounts);
router.post('/accounts', accountController.createAccount);
router.patch('/accounts/:id', accountController.updateAccount);
router.delete('/accounts/:id', accountController.deleteAccount);

module.exports = router;

/**
 * System-wide status constants for Property Management System
 */

const INVOICE_STATUS = {
    DRAFT: 'draft',
    SENT: 'sent',
    UNPAID: 'unpaid',     // Legacy support
    PARTIAL: 'partial',
    PAID: 'paid',
    OVERDUE: 'overdue',
    VOID: 'void'
};

const LEASE_STATUS = {
    DRAFT: 'DRAFT',
    ACTIVE: 'Active',
    EXPIRED: 'Expired',
    MOVED: 'Moved'
};

const PAYMENT_METHOD = {
    ONLINE: 'Online',
    CARD: 'Card',
    BANK: 'Bank Transfer',
    CASH: 'Cash',
    CHEQUE: 'Cheque'
};

const TRANSACTION_TYPE = {
    INCOME: 'Income',
    EXPENSE: 'Expense',
    LIABILITY: 'Liability',
    ASSET: 'Asset'
};

module.exports = {
    INVOICE_STATUS,
    LEASE_STATUS,
    PAYMENT_METHOD,
    TRANSACTION_TYPE
};

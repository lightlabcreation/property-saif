const PDFDocument = require('pdfkit');

/**
 * Generates an Invoice PDF
 * @param {Object} invoice - Invoice object from DB
 * @param {Object} res - Express response object
 * @param {Object} settings - System settings for branding
 */
const generateInvoicePDF = (invoice, res, settings = {}) => {
    const doc = new PDFDocument({ margin: 50 });

    // Set Response Headers
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=invoice-${invoice.invoiceNo}.pdf`);

    doc.pipe(res);

    // Header with Logo
    const logoUrl = settings.company_logo || 'c:\\Users\\Admin\\Desktop\\backup_code_property\\frontend\\public\\assets\\logo.png';
    try {
        // Simple check if it's a local path or URL (simplified for this env)
        doc.image(logoUrl, 50, 45, { width: 40 });
    } catch (e) {
        console.warn('Logo not found or invalid, skipping image');
    }

    const companyName = settings.company_name || 'PropManage SaaS';
    const companyAddress = settings.company_address || '123 Business Avenue, Suite 500\nToronto, ON M5V 2N8';

    doc.fontSize(20).font('Helvetica-Bold').text(companyName, 100, 50);
    doc.fontSize(10).font('Helvetica').text(companyAddress, 100, 80);

    const isService = invoice.category === 'SERVICE';
    doc.fontSize(20).text(isService ? 'SERVICE FEE INVOICE' : 'RENT INVOICE', 50, 140, { align: 'right' });
    doc.moveDown();

    // Invoice Info
    doc.fontSize(12).text(`Invoice Number: ${invoice.invoiceNo}`);
    doc.text(`Date: ${new Date().toLocaleDateString()}`);
    doc.text(`Billing Month: ${invoice.month}`);
    doc.moveDown();

    // Tenant Info
    doc.fontSize(14).text('Billed To:', { underline: true });
    doc.fontSize(12).text(`Tenant: ${invoice.tenant?.name || 'N/A'}`);
    doc.text(`Unit: ${invoice.unit?.name || 'N/A'}`);
    doc.moveDown();

    // Table Header
    const tableTop = 300;
    doc.fontSize(12).text('Description', 50, tableTop);
    doc.text('Amount', 400, tableTop, { align: 'right' });

    doc.moveTo(50, tableTop + 15).lineTo(550, tableTop + 15).stroke();

    // Table Content
    let currentY = tableTop + 30;

    if (isService) {
        doc.text(invoice.description || 'Service Fee Payment', 50, currentY);
        doc.text(`$${parseFloat(invoice.serviceFees || 0).toFixed(2)}`, 400, currentY, { align: 'right' });
        currentY += 20;
    } else {
        doc.text('Monthly Rent Payment', 50, currentY);
        doc.text(`$${parseFloat(invoice.rent || 0).toFixed(2)}`, 400, currentY, { align: 'right' });
        currentY += 20;

        if (parseFloat(invoice.serviceFees || 0) > 0) {
            doc.text('Common Area Service Fees', 50, currentY);
            doc.text(`$${parseFloat(invoice.serviceFees || 0).toFixed(2)}`, 400, currentY, { align: 'right' });
            currentY += 20;
        }
    }

    doc.moveTo(50, currentY).lineTo(550, currentY).stroke();
    currentY += 10;

    // Total
    doc.fontSize(14).text('Total Due:', 300, currentY);
    doc.text(`$${parseFloat(invoice.amount).toFixed(2)}`, 400, currentY, { align: 'right' });

    // Footer
    doc.fontSize(10).text(
        'Thank you for being a valued tenant. Please ensure payments are made before the due date.',
        50,
        700,
        { align: 'center', width: 500 }
    );

    doc.end();
};

/**
 * Generates a Payment Receipt PDF
 * @param {Object} payment - Invoice/Payment object from DB
 * @param {Object} res - Express response object
 */
const generateReceiptPDF = (payment, res) => {
    const doc = new PDFDocument({ margin: 50 });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=receipt-${payment.invoiceNo}.pdf`);

    doc.pipe(res);

    doc.fontSize(25).text('PAYMENT RECEIPT', { align: 'center' });
    doc.moveDown();

    doc.fontSize(12).text(`Receipt Number: RCP-${payment.id}`);
    doc.text(`Date of Payment: ${payment.paidAt ? new Date(payment.paidAt).toLocaleDateString() : 'N/A'}`);
    doc.text(`Invoice Reference: ${payment.invoiceNo}`);
    doc.moveDown();

    doc.fontSize(14).text('Payment Details:', { underline: true });
    doc.fontSize(12).text(`Tenant: ${payment.tenant.name}`);
    doc.text(`Unit: ${payment.unit.name}`);
    doc.text(`Amount Paid: $${parseFloat(payment.amount).toFixed(2)}`);
    doc.text(`Payment Method: ${payment.paymentMethod || 'Online'}`);
    doc.moveDown();

    doc.text('Status: PAID', { align: 'center', color: 'green' });

    doc.end();
};

/**
 * Generates a Lease Agreement PDF (Stub/Template)
 * @param {Object} lease - Lease object from DB
 * @param {Object} res - Express response object
 */
const generateLeasePDF = (lease, res) => {
    const doc = new PDFDocument({ margin: 50 });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=lease-${lease.id}.pdf`);

    doc.pipe(res);

    doc.fontSize(20).text('RESIDENTIAL LEASE AGREEMENT', { align: 'center' });
    doc.moveDown();

    doc.fontSize(12).text(`This agreement is made on ${new Date(lease.createdAt).toLocaleDateString()}.`);
    doc.moveDown();

    doc.text(`Landlord: PropManage SaaS Represented Owners`);
    doc.text(`Tenant: ${lease.tenant.name}`);
    doc.moveDown();

    doc.fontSize(14).text('1. PREMISES', { underline: true });
    doc.fontSize(12).text(`The landlord leases to the tenant the premises located at: Unit ${lease.unit.name}, ${lease.unit.property.name}.`);
    doc.moveDown();

    doc.fontSize(14).text('2. TERM', { underline: true });
    doc.fontSize(12).text(`The lease term shall begin on ${new Date(lease.startDate).toLocaleDateString()} and end on ${new Date(lease.endDate).toLocaleDateString()}.`);
    doc.moveDown();

    doc.fontSize(14).text('3. RENT', { underline: true });
    doc.fontSize(12).text(`The monthly rent shall be $${parseFloat(lease.monthlyRent).toFixed(2)} payable on the 1st of each month.`);
    doc.moveDown();

    doc.fontSize(14).text('4. SECURITY DEPOSIT', { underline: true });
    doc.fontSize(12).text(`The tenant has paid a security deposit of $${parseFloat(lease.securityDeposit).toFixed(2)}.`);
    doc.moveDown();

    doc.text('This is a formal lease agreement generated by PropManage SaaS.', 50, 700, { align: 'center' });

    doc.end();
};

/**
 * Generates a Generic Report PDF
 * @param {string} reportId - ID of report (placeholder logic)
 * @param {Object} res - Express response object
 */
const generateReportPDF = (reportId, res) => {
    const doc = new PDFDocument({ margin: 50 });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=report-${reportId}.pdf`);

    doc.pipe(res);

    doc.fontSize(25).text('DATA EXPORT REPORT', { align: 'center' });
    doc.moveDown();

    doc.fontSize(12).text(`Report Type: ${reportId}`);
    doc.text(`Generated On: ${new Date().toLocaleString()}`);
    doc.moveDown();

    doc.text('This PDF contains a summary of the requested data export from PropManage SaaS.');
    doc.moveDown();

    doc.text('Summary Data Placeholder:', { underline: true });
    doc.fontSize(10).text('Monthly Revenue: $120,500.00');
    doc.text('Occupancy Rate: 94%');
    doc.text('Active Leases: 42');
    doc.moveDown();

    doc.end();
};

module.exports = {
    generateInvoicePDF,
    generateReceiptPDF,
    generateLeasePDF,
    generateReportPDF
};

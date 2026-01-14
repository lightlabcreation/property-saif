require('dotenv').config();
const app = require('./app');
const prisma = require('./config/prisma');
const { initLeaseCron } = require('./services/cron.service');
const { initMonthlyInvoiceCron } = require('./services/invoice.cron');

const PORT = process.env.PORT || 5000;

async function startServer() {
    try {
        // Check DB connection
        await prisma.$connect();
        console.log('✅ Database connected successfully');

        // Initialize cron jobs
        initLeaseCron();
        initMonthlyInvoiceCron();

        console.log('DEBUG: JWT_SECRET length:', process.env.JWT_SECRET ? process.env.JWT_SECRET.length : 'undefined');

        app.listen(PORT, () => {
            console.log(`🚀 Server running on port ${PORT}`);
        });
    } catch (error) {
        console.error('❌ Failed to start server:', error);
        process.exit(1);
    }
}

startServer();

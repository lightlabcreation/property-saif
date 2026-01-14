const prisma = require('../../config/prisma');

// Helper to calculate status
const getPolicyStatus = (endDate) => {
    const end = new Date(endDate);
    const today = new Date();
    const diffTime = end - today;
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays < 0) return 'EXPIRED';
    if (diffDays <= 30) return 'EXPIRING_SOON';
    return 'ACTIVE';
};

// GET /api/tenant/insurance
exports.getInsurance = async (req, res) => {
    try {
        const userId = req.user.id;
        const insurance = await prisma.insurance.findFirst({
            where: { userId },
            orderBy: { createdAt: 'desc' }
        });

        if (!insurance) {
            return res.json(null);
        }

        res.json({
            id: insurance.id,
            provider: insurance.provider,
            policyNumber: insurance.policyNumber,
            startDate: insurance.startDate.toISOString().substring(0, 10),
            endDate: insurance.endDate.toISOString().substring(0, 10),
            documentUrl: insurance.documentUrl,
            status: getPolicyStatus(insurance.endDate)
        });

    } catch (e) {
        console.error(e);
        res.status(500).json({ message: 'Server error' });
    }
};

// POST /api/tenant/insurance
exports.uploadInsurance = async (req, res) => {
    try {
        const userId = req.user.id;
        const { provider, policyNumber, startDate, endDate } = req.body;

        if (!provider || !policyNumber || !startDate || !endDate) {
            return res.status(400).json({ message: 'Missing required fields' });
        }

        // Find tenant's active unit
        const activeLease = await prisma.lease.findFirst({
            where: {
                tenantId: userId,
                status: 'Active'
            },
            select: { unitId: true }
        });

        // Handle file upload
        let documentUrl = null;
        if (req.file) {
            documentUrl = `/uploads/${req.file.filename}`;
        }

        // According to requirements: "Replace old policy if needed"
        // Let's check for existing first.
        const existing = await prisma.insurance.findFirst({
            where: { userId }
        });

        let insurance;
        const data = {
            provider,
            policyNumber,
            startDate: new Date(startDate),
            endDate: new Date(endDate),
            unitId: activeLease ? activeLease.unitId : null,
            documentUrl: documentUrl || (existing ? existing.documentUrl : null)
        };

        if (existing) {
            insurance = await prisma.insurance.update({
                where: { id: existing.id },
                data
            });
        } else {
            insurance = await prisma.insurance.create({
                data: {
                    userId,
                    ...data
                }
            });
        }

        res.status(201).json({
            ...insurance,
            status: getPolicyStatus(insurance.endDate)
        });

    } catch (e) {
        console.error('Error in uploadInsurance:', e);
        // If file was uploaded but DB failed, we should ideally delete it
        if (req.file) {
            const fs = require('fs');
            const path = require('path');
            const filePath = path.join(__dirname, '../../../uploads', req.file.filename);
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
            }
        }
        res.status(500).json({ message: 'Error uploading insurance' });
    }
};

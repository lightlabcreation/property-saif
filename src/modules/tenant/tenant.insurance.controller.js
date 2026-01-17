const prisma = require('../../config/prisma');
const documentService = require('../../services/documentService');
const { uploadToCloudinary } = require('../../config/cloudinary');

// Helper to determine expiry label for UI
const getExpiryLabel = (endDate) => {
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
            include: { document: true },
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
            status: insurance.status,
            expiryLabel: getExpiryLabel(insurance.endDate)
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
        const { provider, policyNumber, startDate, endDate, coverageType } = req.body;

        if (!provider || !policyNumber || !startDate || !endDate) {
            return res.status(400).json({ message: 'Missing required fields' });
        }

        // 1. Get user data to link property/unit
        const user = await prisma.user.findUnique({
            where: { id: userId },
            include: {
                leases: {
                    where: { status: 'Active' },
                    take: 1
                }
            }
        });

        const activeLease = user?.leases?.[0];

        // 2. Handle file upload and create Document record
        let documentUrl = null;
        let uploadedDocId = null;

        if (req.files && req.files.file) {
            const file = req.files.file;
            const result = await uploadToCloudinary(file.tempFilePath, 'tenant_insurance');
            documentUrl = result.secure_url;

            // Use centralized DocumentService for linking
            const doc = await documentService.linkDocument({
                type: 'Insurance',
                fileUrl: documentUrl,
                userId: userId,
                leaseId: activeLease?.id || null,
                unitId: user?.unitId || null,
                propertyId: user?.buildingId || null
            });
            uploadedDocId = doc.id;
        }

        // 3. Create or replace Insurance record (Set to PENDING_APPROVAL)
        const insurance = await prisma.insurance.create({
            data: {
                userId,
                provider,
                policyNumber,
                coverageType,
                startDate: new Date(startDate),
                endDate: new Date(endDate),
                documentUrl,
                uploadedDocumentId: uploadedDocId,
                status: 'PENDING_APPROVAL',
                leaseId: activeLease?.id || null,
                unitId: user?.unitId || null
            }
        });

        res.status(201).json({
            ...insurance,
            expiryLabel: getExpiryLabel(insurance.endDate)
        });

    } catch (e) {
        console.error('Error in uploadInsurance:', e);
        res.status(500).json({ message: 'Error uploading insurance data' });
    }
};

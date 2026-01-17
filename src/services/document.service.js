const prisma = require('../config/prisma');

class DocumentService {
    /**
     * Create a document record with automatic naming and relational linking
     */
    static async createDocument({
        userId = null,
        leaseId = null,
        unitId = null,
        propertyId = null,
        invoiceId = null,
        type, // e.g., 'Insurance', 'LeaseAgreement', 'IDProof'
        fileUrl,
        originalName = null
    }) {
        try {
            const dateStr = new Date().toISOString().split('T')[0];
            const entityType = userId ? 'TENANT' : propertyId ? 'PROPERTY' : leaseId ? 'LEASE' : unitId ? 'UNIT' : 'DOC';
            const cleanType = type.toUpperCase().replace(/\s+/g, '-');

            // Format: [ENTITY]-[TYPE]-[DATE].pdf
            const docName = `${entityType}-${cleanType}-${dateStr}.pdf`;

            const document = await prisma.document.create({
                data: {
                    name: docName,
                    type,
                    fileUrl,
                    userId,
                    leaseId,
                    unitId,
                    propertyId,
                    invoiceId
                }
            });

            return document;
        } catch (e) {
            console.error('[DocumentService] Error:', e);
            throw e;
        }
    }

    /**
     * Get documents based on permissions
     */
    static async getPermissionsFilteredDocuments({ userRole, userId, propertyIds = [] }) {
        const where = {};

        if (userRole === 'TENANT') {
            where.userId = userId;
        } else if (userRole === 'OWNER') {
            // Owners see documents linked to their properties
            where.propertyId = { in: propertyIds };
        }
        // ADMIN sees all (where = {})

        return prisma.document.findMany({
            where,
            include: {
                user: true,
                lease: true,
                unit: { include: { property: true } },
                property: true
            },
            orderBy: { createdAt: 'desc' }
        });
    }
}

module.exports = DocumentService;

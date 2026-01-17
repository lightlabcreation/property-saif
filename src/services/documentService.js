const prisma = require('../config/prisma');

class DocumentService {

    /**
     * Create a document record with automated naming and relational links
     */
    async linkDocument({ name, type, fileUrl, userId, propertyId, unitId, leaseId, invoiceId, expiryDate }) {
        try {
            // Enforce Standard Naming [ENTITY]-[TYPE]-[DATE]
            const dateStr = new Date().toISOString().split('T')[0];
            const entityLabel = type.toUpperCase();
            const standardizedName = name || `${entityLabel}-${dateStr}.pdf`;

            const doc = await prisma.document.create({
                data: {
                    name: standardizedName,
                    type,
                    fileUrl,
                    userId: userId || null,
                    propertyId: propertyId || null,
                    unitId: unitId || null,
                    leaseId: leaseId || null,
                    invoiceId: invoiceId || null,
                    expiryDate: expiryDate ? new Date(expiryDate) : null
                }
            });

            return doc;
        } catch (error) {
            console.error('Failed to link document:', error);
            throw error;
        }
    }

    /**
     * Delete a document and its relations
     */
    async deleteDocument(id) {
        return prisma.document.delete({
            where: { id: parseInt(id) }
        });
    }

    /**
     * Fetch all documents for Admin with inclusions
     */
    async getAllDocuments() {
        return prisma.document.findMany({
            include: {
                user: true,
                property: true,
                unit: true,
                lease: true,
                invoice: true
            },
            orderBy: { createdAt: 'desc' }
        });
    }
}

module.exports = new DocumentService();

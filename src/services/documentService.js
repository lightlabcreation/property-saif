const prisma = require('../config/prisma');

class DocumentService {

    /**
     * Create a document record with automated naming and multi-entity links
     */
    async linkDocument({ name, type, fileUrl, links = [], expiryDate, ...legacyFields }) {
        try {
            // Enforce Standard Naming [ENTITY]-[TYPE]-[DATE]
            const dateStr = new Date().toISOString().split('T')[0];
            const entityLabel = type.toUpperCase();
            const standardizedName = name || `${entityLabel}-${dateStr}.pdf`;

            // Prepare links from both explicit 'links' array and legacy individual fields
            const allLinks = [...links];
            if (legacyFields.userId) allLinks.push({ entityType: 'USER', entityId: legacyFields.userId });
            if (legacyFields.propertyId) allLinks.push({ entityType: 'PROPERTY', entityId: legacyFields.propertyId });
            if (legacyFields.unitId) allLinks.push({ entityType: 'UNIT', entityId: legacyFields.unitId });
            if (legacyFields.leaseId) allLinks.push({ entityType: 'LEASE', entityId: legacyFields.leaseId });
            if (legacyFields.invoiceId) allLinks.push({ entityType: 'INVOICE', entityId: legacyFields.invoiceId });

            const doc = await prisma.document.create({
                data: {
                    name: standardizedName,
                    type,
                    fileUrl,
                    userId: legacyFields.userId || null,
                    propertyId: legacyFields.propertyId || null,
                    unitId: legacyFields.unitId || null,
                    leaseId: legacyFields.leaseId || null,
                    invoiceId: legacyFields.invoiceId || null,
                    expiryDate: expiryDate ? new Date(expiryDate) : null,
                    links: {
                        create: allLinks.map(l => ({
                            entityType: l.entityType.toUpperCase(),
                            entityId: parseInt(l.entityId)
                        }))
                    }
                },
                include: { links: true }
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
        // First delete associated links to prevent foreign key constraint errors
        await prisma.documentLink.deleteMany({
            where: { documentId: parseInt(id) }
        });

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
                invoice: true,
                links: true
            },
            orderBy: { createdAt: 'desc' }
        });
    }
}

module.exports = new DocumentService();

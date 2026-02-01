const prisma = require('../../config/prisma');
const path = require('path');
const documentService = require('../../services/documentService');
const fs = require('fs');

// GET /api/admin/documents
exports.getAllDocuments = async (req, res) => {
    try {
        const documents = await prisma.document.findMany({
            include: {
                user: true,
                lease: {
                    include: { tenant: true }
                },
                unit: true,
                property: true,
                invoice: true
            },
            orderBy: { createdAt: 'desc' }
        });

        res.json(documents);
    } catch (e) {
        console.error(e);
        res.status(500).json({ message: 'Server error' });
    }
};

const https = require('https');

// GET /api/admin/documents/:id/download
exports.downloadDocument = async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const doc = await prisma.document.findUnique({
            where: { id }
        });

        if (!doc || !doc.fileUrl) {
            return res.status(404).json({ message: 'Document not found' });
        }

        const fileName = doc.name || `document-${id}.pdf`;

        // Handle Cloudinary URLs (Absolute) - Proxy via HTTPS
        if (doc.fileUrl.startsWith('http')) {
            return https.get(doc.fileUrl, (proxyRes) => {
                if (proxyRes.statusCode !== 200) {
                    return res.status(proxyRes.statusCode).json({ message: 'Failed to fetch file from storage' });
                }

                // Set headers for inline preview (or download if disposition=attachment)
                const disposition = req.query.disposition || 'inline';
                res.setHeader('Content-Type', proxyRes.headers['content-type'] || 'application/pdf');
                res.setHeader('Content-Disposition', `${disposition}; filename="${fileName}"`);

                // Pipe the response
                proxyRes.pipe(res);
            }).on('error', (err) => {
                console.error('Proxy error:', err);
                res.status(500).json({ message: 'Error streaming file' });
            });
        }

        // Handle Local Files (Relative)
        const absolutePath = path.resolve(process.cwd(), doc.fileUrl.startsWith('/') ? doc.fileUrl.substring(1) : doc.fileUrl);

        const disposition = req.query.disposition || 'inline';
        if (disposition === 'inline') {
            res.sendFile(absolutePath, (err) => {
                if (err) {
                    console.error('File send error:', err);
                    if (!res.headersSent) res.status(404).json({ message: 'File not found' });
                }
            });
        } else {
            res.download(absolutePath, fileName, (err) => {
                if (err) {
                    console.error('File download error:', err);
                    if (!res.headersSent) res.status(404).json({ message: 'File on disk not found' });
                }
            });
        }

    } catch (e) {
        console.error(e);
        res.status(500).json({ message: 'Server error during download' });
    }
};

// POST /api/admin/documents/upload
exports.uploadDocument = async (req, res) => {
    try {
        if (!req.files || Object.keys(req.files).length === 0) {
            return res.status(400).json({ message: 'No files were uploaded.' });
        }

        const file = req.files.file;
        const { type, name, expiryDate, links } = req.body;

        if (!type) {
            return res.status(400).json({ message: 'Document type is required.' });
        }

        // Save file locally (Simple mock for now, ideally Cloudinary/S3)
        const uploadPath = path.join(process.cwd(), 'uploads', `${Date.now()}-${file.name}`);

        // Ensure uploads directory exists
        const dir = path.dirname(uploadPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }

        await file.mv(uploadPath);

        // Normalize links
        let parsedLinks = [];
        try {
            parsedLinks = links ? JSON.parse(links) : [];
            console.log('📎 Parsed links:', parsedLinks);
        } catch (e) {
            console.error('Failed to parse links:', e);
        }

        // Extract primary link for legacy fields (for Prisma include to work)
        const legacyFields = {};
        parsedLinks.forEach(link => {
            const entityType = link.entityType.toUpperCase();
            const entityId = parseInt(link.entityId);

            if (entityType === 'USER' && !legacyFields.userId) {
                legacyFields.userId = entityId;
            } else if (entityType === 'LEASE' && !legacyFields.leaseId) {
                legacyFields.leaseId = entityId;
            } else if (entityType === 'UNIT' && !legacyFields.unitId) {
                legacyFields.unitId = entityId;
            } else if (entityType === 'PROPERTY' && !legacyFields.propertyId) {
                legacyFields.propertyId = entityId;
            } else if (entityType === 'INVOICE' && !legacyFields.invoiceId) {
                legacyFields.invoiceId = entityId;
            }
        });

        console.log('🔗 Legacy fields extracted:', legacyFields);

        // Use service to create record and links
        const doc = await documentService.linkDocument({
            name: name || file.name,
            type,
            fileUrl: `/uploads/${path.basename(uploadPath)}`,
            links: parsedLinks,
            expiryDate,
            ...legacyFields
        });

        console.log('✅ Document created:', { id: doc.id, name: doc.name, leaseId: doc.leaseId, userId: doc.userId });

        res.status(201).json(doc);
    } catch (e) {
        console.error('Upload Error:', e);
        res.status(500).json({ message: 'Failed to upload document' });
    }
};

// DELETE /api/admin/documents/:id
exports.deleteDocument = async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const doc = await prisma.document.findUnique({ where: { id } });

        // Delete actual file if local
        if (doc && doc.fileUrl && !doc.fileUrl.startsWith('http')) {
            const filePath = path.join(process.cwd(), doc.fileUrl);
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
            }
        }

        await documentService.deleteDocument(id);
        res.json({ message: 'Document deleted successfully' });
    } catch (e) {
        console.error(e);
        res.status(500).json({ message: 'Failed to delete document' });
    }
};

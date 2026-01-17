const prisma = require('../../config/prisma');
const path = require('path');
const documentService = require('../../services/documentService');

// GET /api/admin/documents
exports.getAllDocuments = async (req, res) => {
    try {
        const documents = await prisma.document.findMany({
            include: {
                user: true,
                lease: true,
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

                // Set headers for download
                res.setHeader('Content-Type', proxyRes.headers['content-type'] || 'application/pdf');
                res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);

                // Pipe the response
                proxyRes.pipe(res);
            }).on('error', (err) => {
                console.error('Proxy error:', err);
                res.status(500).json({ message: 'Error streaming file' });
            });
        }

        // Handle Local Files (Relative)
        const absolutePath = path.resolve(process.cwd(), doc.fileUrl.startsWith('/') ? doc.fileUrl.substring(1) : doc.fileUrl);

        res.download(absolutePath, fileName, (err) => {
            if (err) {
                console.error('File download error:', err);
                if (!res.headersSent) {
                    res.status(404).json({ message: 'File on disk not found' });
                }
            }
        });

    } catch (e) {
        console.error(e);
        res.status(500).json({ message: 'Server error during download' });
    }
};

// DELETE /api/admin/documents/:id
exports.deleteDocument = async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        await documentService.deleteDocument(id);
        res.json({ message: 'Document deleted successfully' });
    } catch (e) {
        console.error(e);
        res.status(500).json({ message: 'Failed to delete document' });
    }
};

const prisma = require('../../config/prisma');
const { uploadToCloudinary } = require('../../config/cloudinary');

const axios = require('axios');

// GET /api/tenant/documents
exports.getDocuments = async (req, res) => {
    try {
        const userId = req.user.id;
        const documents = await prisma.document.findMany({
            where: { userId }
        });

        const formatted = documents.map(d => ({
            id: d.id,
            name: d.name,
            type: d.type,
            fileUrl: d.fileUrl,
            date: d.createdAt.toISOString().split('T')[0]
        }));

        res.json(formatted);
    } catch (e) {
        console.error(e);
        res.status(500).json({ message: 'Server error' });
    }
};

// GET /api/tenant/documents/:id
exports.getDocumentById = async (req, res) => {
    try {
        const userId = req.user.id;
        const { id } = req.params;

        const document = await prisma.document.findFirst({
            where: { id: parseInt(id), userId }
        });

        if (!document) return res.status(404).json({ message: 'Document not found' });

        res.json(document);
    } catch (e) {
        console.error(e);
        res.status(500).json({ message: 'Server error' });
    }
};

// GET /api/tenant/documents/:id/download
exports.downloadDocument = async (req, res) => {
    try {
        const userId = req.user.id;
        const { id } = req.params;

        const document = await prisma.document.findFirst({
            where: { id: parseInt(id), userId }
        });

        if (!document || !document.fileUrl) {
            return res.status(404).json({ message: 'Document not found' });
        }

        // Use axios to stream from Cloudinary
        const response = await axios({
            method: 'GET',
            url: document.fileUrl,
            responseType: 'stream'
        });

        // Set headers for download
        const filename = document.name || 'document';
        const extension = document.fileUrl.split('.').pop().split('?')[0]; // Extract extension from URL, handling queries

        // Ensure filename ends correctly
        const finalFilename = filename.toLowerCase().endsWith(extension.toLowerCase())
            ? filename
            : `${filename}.${extension}`;

        res.setHeader('Content-disposition', `attachment; filename="${finalFilename}"`);
        res.setHeader('Content-type', response.headers['content-type']);

        response.data.pipe(res);
    } catch (e) {
        console.error('Download Error:', e);
        res.status(500).json({ message: 'Error downloading document' });
    }
};

// POST /api/tenant/documents
exports.uploadDocument = async (req, res) => {
    try {
        const userId = req.user.id;
        const { name, type } = req.body; // Adjusted to match frontend payload

        if (!req.files || !req.files.file) {
            return res.status(400).json({ message: 'No file uploaded' });
        }

        const file = req.files.file;

        // Upload to Cloudinary
        // Note: cloudConfig ensures temp file is deleted after upload
        const result = await uploadToCloudinary(file.tempFilePath, 'tenant_documents');

        const newDoc = await prisma.document.create({
            data: {
                userId,
                name: name || file.name,
                type: type || 'Other',
                fileUrl: result.secure_url,
                expiryDate: null
            }
        });

        res.status(201).json({
            id: newDoc.id,
            name: newDoc.name,
            type: newDoc.type,
            fileUrl: newDoc.fileUrl,
            date: newDoc.createdAt.toISOString().split('T')[0]
        });

    } catch (e) {
        console.error('Document Upload Error:', e);
        res.status(500).json({ message: 'Error uploading document' });
    }
};

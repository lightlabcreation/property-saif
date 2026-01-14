const prisma = require('../../config/prisma');
const { uploadToCloudinary } = require('../../config/cloudinary');

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

// POST /api/tenant/documents
exports.uploadDocument = async (req, res) => {
    try {
        const userId = req.user.id;
        const { friendlyName, documentType } = req.body;

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
                name: friendlyName || file.name,
                type: documentType || 'Other',
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

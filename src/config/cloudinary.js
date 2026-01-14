const cloudinary = require('cloudinary').v2;
const fs = require('fs');
const dotenv = require('dotenv');

dotenv.config();

// Configure Cloudinary
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

/**
 * Uploads a file to Cloudinary and deletes the temporary local file.
 * @param {string} filePath - Path to the temporary file
 * @param {string} folder - Cloudinary folder name
 * @returns {Promise<Object>} - Cloudinary upload response
 */
const uploadToCloudinary = async (filePath, folder = 'property_management') => {
    try {
        const result = await cloudinary.uploader.upload(filePath, {
            folder: folder,
            resource_type: 'auto'
        });

        // Delete temporary file
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }

        return result;
    } catch (error) {
        // Ensure temporary file is deleted even on error
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }
        console.error('Cloudinary Upload Error:', error);
        throw error;
    }
};

/**
 * Deletes a file from Cloudinary.
 * @param {string} publicId - Cloudinary public ID of the file
 * @returns {Promise<Object>} - Cloudinary deletion response
 */
const deleteFromCloudinary = async (publicId) => {
    try {
        const result = await cloudinary.uploader.destroy(publicId);
        return result;
    } catch (error) {
        console.error('Cloudinary Deletion Error:', error);
        throw error;
    }
};

module.exports = {
    cloudinary,
    uploadToCloudinary,
    deleteFromCloudinary
};

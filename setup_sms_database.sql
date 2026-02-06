-- =====================================================
-- SMS Integration Database Setup
-- =====================================================
-- This script adds SMS tracking fields to the message table
-- Run this if the Prisma migration fails
-- =====================================================

USE property_management;

-- Check if columns already exist
SELECT 
    COLUMN_NAME,
    DATA_TYPE,
    COLUMN_DEFAULT
FROM INFORMATION_SCHEMA.COLUMNS 
WHERE TABLE_NAME = 'message' 
  AND TABLE_SCHEMA = 'property_management'
  AND COLUMN_NAME IN ('sentVia', 'smsSid', 'smsStatus');

-- Add SMS tracking columns (will skip if already exists)
ALTER TABLE `message` 
ADD COLUMN IF NOT EXISTS `sentVia` VARCHAR(191) NOT NULL DEFAULT 'app' COMMENT 'Channel: app, sms, or both',
ADD COLUMN IF NOT EXISTS `smsSid` VARCHAR(191) NULL COMMENT 'Twilio message SID',
ADD COLUMN IF NOT EXISTS `smsStatus` VARCHAR(191) NULL COMMENT 'SMS delivery status: sent, delivered, failed, received';

-- Verify columns were added
SELECT 
    COLUMN_NAME,
    DATA_TYPE,
    COLUMN_DEFAULT,
    COLUMN_COMMENT
FROM INFORMATION_SCHEMA.COLUMNS 
WHERE TABLE_NAME = 'message' 
  AND TABLE_SCHEMA = 'property_management'
ORDER BY ORDINAL_POSITION;

-- Show sample data
SELECT 
    id,
    content,
    sentVia,
    smsStatus,
    smsSid,
    createdAt
FROM message
ORDER BY createdAt DESC
LIMIT 5;

SELECT '✅ SMS fields added successfully!' AS Status;

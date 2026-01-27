/**
 * Unit Type Configuration
 * 
 * This file defines valid unit types for the system.
 * To add a new unit type, simply add it to the VALID_UNIT_TYPES array.
 * 
 * No code changes required - this is the single source of truth.
 */

const VALID_UNIT_TYPES = [
    'Mackenzie',
    'Nelson',
    'Hudson',
    'Richelieu',
    'Rupert'
];

/**
 * Validate if a unit type is valid
 * @param {string} unitType - The unit type to validate
 * @returns {boolean} - True if valid, false otherwise
 */
function isValidUnitType(unitType) {
    if (!unitType) return true; // null/undefined is allowed (optional field)
    return VALID_UNIT_TYPES.includes(unitType);
}

/**
 * Get all valid unit types
 * @returns {Array<string>} - Array of valid unit types
 */
function getValidUnitTypes() {
    return [...VALID_UNIT_TYPES];
}

module.exports = {
    VALID_UNIT_TYPES,
    isValidUnitType,
    getValidUnitTypes
};

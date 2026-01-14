# Backend Integration Report - Remove Owner selection from Add Building

## Changes Implemented
*   **Users Request**: Remove "Owner" selection from "Add Building" modal.
*   **Frontend**:
    *   Removed `ownerId` logic from `addBuilding` function in `Buildings.jsx`.
    *   Removed the "Owner" dropdown (`<select>`) from the `Add Building` modal form.
*   **Backend Check**:
    *   Verified `createProperty` in `admin.controller.js`.
    *   Logic `ownerId: ownerId ? parseInt(ownerId) : null` correctly handles missing ownerId.

## Verification
*   **Add Building**: User can now add a building providing only Name and Units.
*   **Result**: Building is created with `ownerId: null` in the database, which is valid schema behavior.

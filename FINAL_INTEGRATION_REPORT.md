# Backend Integration Report - Buildings Page (Updated)

## Updates
*   **Added Owner Selection**: Updated `Buildings.jsx` to fetch and display a list of Owners in the "Add Building" modal.
*   **Backend Update**: Updated `admin.controller.js` to handle `ownerId` in `createProperty` and added `getOwners` endpoint.
*   **Routes**: Added valid route `GET /api/admin/owners`.

## Details
*   **Validation**: The frontend now sends `ownerId` if selected.
*   **Database**: The `Property` record is now correctly linked to the `User` (Owner) in the database.

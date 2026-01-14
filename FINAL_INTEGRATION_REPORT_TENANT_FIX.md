# Backend Integration Report - Fix Update Tenant

## Fixed Issue
User reported "Update button not working" in the Edit Tenant modal.
*   **Cause**: The frontend was still using legacy code that updated a local `tenants` state array instead of calling the backend API.
*   **Resolution**: Replaced the local state update logic with `api.put('/admin/tenants/:id', payload)`.

## Logic Flow
1.  **Frontend**:
    *   Captures form data (Name, Type, Email, Phone, Unit ID).
    *   Sends `PUT` request to backend.
    *   Awaits response.
    *   Refreshes the full list via `fetchTenants()` to show updated data (including derived fields like Property Name).
2.  **Backend** (Existing):
    *   Receives `unitId`.
    *   If `unitId` changed, performs the Transactional Unit Swap (Vacate Old -> Occupy New).
    *   Updates User profile info.

## Verification
*   **Edit -> Save**: Now persists to the database.
*   **Page Refresh**: Data remains updated.

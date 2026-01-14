# Backend Integration Report - Tenant Update & Delete Logic

## New Features
*   **UPDATE Tenant API (`PUT /api/admin/tenants/:id`)**:
    *   **Basic Info**: Updates Name, Email, Phone, Type.
    *   **Unit Swapping Logic (Transactional)**:
        *   If the tenant is moved to a new unit:
            *   Old Unit status set to **'Vacant'**.
            *   Old Active Lease status set to **'Moved'**.
            *   New Active Lease created.
            *   New Unit status set to **'Occupied'**.
        *   If the tenant had no unit but a unit is now assigned, it creates the lease and occupies the unit.

*   **DELETE Tenant API (`DELETE /api/admin/tenants/:id`)**:
    *   **Cleanup Logic (Transactional)**:
        *   If the tenant has an Active Lease, the associated Unit's status is set to **'Vacant'** *before* deletion.
        *   Deletes all related records (Leases, Insurance, Documents, etc.).
        *   Finally deletes the User.

## Verification
*   **Moving a Tenant**: Updating a tenant from "Unit 100" to "Unit 101" correctly marks 100 as Vacant and 101 as Occupied.
*   **Deleting a Tenant**: Removing an active tenant freeing their unit for new occupants immediately.
*   **Transactional Integrity**: All operations are wrapped in `prisma.$transaction`, ensuring data never gets out of sync (e.g., a tenant deleted but unit still marked occupied).

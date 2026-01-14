# Backend Integration Report - Tenants (Updated)

## Updates
*   **Unit Filtering**: The "Unit / Bedroom" dropdown in the "Add/Edit Tenant" modal now strictly filters units.
    *   **Rule**: Lists only units where `status` is `'Vacant'`.
    *   **Exception**: If **Editing**, the tenant's *current* unit is also included in the list (even if Occupied) to ensure the form displays correctly.

## Verification
*   **Add Tenant**: When selecting a property, only Vacant units appear.
*   **Edit Tenant**: Users can see their existing unit selected, plus any other available vacant units if they wish to move.

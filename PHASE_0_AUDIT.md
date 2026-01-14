# Phase 0 - Frontend API Audit & Replacement Plan

## Overview
The frontend currently uses hardcoded mock data (`MOCK_DATA` arrays) directly within components.
There are NO existing `fetch` calls.
The goal is to implement the following backend endpoints and wire them into the frontend.

## Authentication (Admin, Owner, Tenant)
- **POST** `/api/auth/login`
  - **Payload**: `{ email, password }`
  - **Response**: `{ accessToken, refreshToken, user: { id, name, role, email } }`
  - **Impact**: Replace hardcoded auth check in `Login.jsx` (Admin), `owner/OwnerLogin.jsx` (Owner), `tenant/TenantLogin.jsx` (Tenant).

## Admin Module
### Dashboard (`Dashboard.jsx`)
- **GET** `/api/admin/dashboard/stats`
  - **Response**:
    ```json
    {
      "totalProperties": 12,
      "totalUnits": 48,
      "occupancy": { "occupied": 38, "vacant": 10 },
      "monthlyRevenue": 18450,
      "insuranceAlerts": { "expired": 3, "expiringSoon": 3 },
      "recentActivity": [{ "desc": "Unit 301 rented..." }]
    }
    ```

### Properties (`Properties.jsx`)
- **GET** `/api/admin/properties`
  - **Response**:
    ```json
    [
      { "id": 1, "name": "Sunset Apartments", "address": "...", "unitsCount": 12, "occupancyRate": 92, "status": "Active" }
    ]
    ```

- **POST** `/api/admin/properties` (For "Add Property" button - likely needs a modal implementation or page)

### Property Detail (`PropertyDetail.jsx`)
- **GET** `/api/admin/properties/:id`
  - **Response**: Full property details, including related buildings/units summary.

### Units (`Units.jsx`)
- **GET** `/api/admin/units`
  - **Response**: List of all units with status.

### Tenants (`Tenants.jsx`)
- **GET** `/api/admin/tenants`
  - **Response**: List of tenants.

## Setup Requirements
- **Database**: MySQL.
- **ORM**: Prisma.
- **Server**: Express.
- **Structure**:
  - `User` (Shared for auth)
  - `Property`
  - `Unit`
  - `Tenant` (Profile linked to User)
  - `Lease`
  - `Payment`

## Next Steps (Phase 1)
1. Initialize Prisma Schema with `User` (Admin role) and `Property` models.
2. Implement `POST /auth/login`.
3. Implement `GET /admin/dashboard/stats` (initially with real DB counts).
4. Connect `Login.jsx` to API.
5. Connect `Dashboard.jsx` to API.

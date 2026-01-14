# Property Management Backend

## Overview
Node.js/Express backend for the Property Management System.
Built with Prisma ORM and MySQL.

## Structure
- `src/app.js`: Express app setup.
- `src/server.js`: Server entry point.
- `src/modules/`: Feature modules (Admin, Owner, Tenant).
- `src/config/`: Configuration (Prisma, etc.).
- `prisma/`: Database schema and migrations.

## Getting Started

### Prerequisites
- Node.js
- MySQL

### Setup
1. Install dependencies:
   ```bash
   npm install
   ```
2. Set up environment variables in `.env`:
   ```
   DATABASE_URL="mysql://user:password@localhost:3306/property_db"
   JWT_SECRET="your_secret"
   PORT=5000
   ```
3. Run migrations:
   ```bash
   npx prisma migrate dev
   ```
4. Start server:
   ```bash
   npm run dev
   ```

## API Documentation
See `docs/` or `PHASE_0_AUDIT.md` for details.

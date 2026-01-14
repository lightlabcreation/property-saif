const prisma = require("../src/config/prisma");
const bcrypt = require("bcrypt");
require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });

async function main() {
  console.log("🌱 Starting seed...");

  const hashedPassword = await bcrypt.hash("123456", 10);

  // 1. Admin
  await prisma.user.upsert({
    where: { email: "admin@property.com" },
    update: {},
    create: {
      email: "admin@property.com",
      name: "Super Admin",
      password: hashedPassword,
      role: "ADMIN",
    },
  });

  // 2. Owner
  const owner = await prisma.user.upsert({
    where: { email: "owner@property.com" },
    update: {},
    create: {
      email: "owner@property.com",
      name: "Mr. Landlord",
      password: hashedPassword,
      role: "OWNER",
    },
  });

  // 3. Property + Units
  let sunset = await prisma.property.findFirst({
    where: { name: "Sunset Apartments" },
  });
  if (!sunset) {
    sunset = await prisma.property.create({
      data: {
        name: "Sunset Apartments",
        address: "123 Sunset Blvd, CA",
        status: "Active",
        ownerId: owner.id,
        units: {
          create: Array.from({ length: 12 }).map((_, i) => ({
            name: `${101 + i}`,
            status: i < 11 ? "Occupied" : "Vacant",
            rentAmount: 1200,
            bedrooms: 2,
          })),
        },
      },
      include: { units: true },
    });
  }

  // 4. Tenant
  let tenant = await prisma.user.findUnique({
    where: { email: "tenant@example.com" },
  });
  if (!tenant) {
    tenant = await prisma.user.create({
      data: {
        email: "tenant@example.com",
        password: hashedPassword,
        name: "John Smith",
        role: "TENANT",
        phone: "+1 (555) 012-3456",
        type: "Individual",
        insurances: {
          create: [
            {
              provider: "State Farm",
              policyNumber: "SF-12345",
              startDate: new Date("2025-01-01"),
              endDate: new Date("2026-01-01"),
            },
          ],
        },
      },
    });
  }

  // 5. Lease for Unit 101
  const unit101 = await prisma.unit.findFirst({
    where: { propertyId: sunset.id, name: "101" },
  });
  if (unit101) {
    const leaseExists = await prisma.lease.findFirst({
      where: { unitId: unit101.id },
    });
    if (!leaseExists) {
      await prisma.lease.create({
        data: {
          unitId: unit101.id,
          tenantId: tenant.id,
          startDate: new Date("2025-01-01"),
          endDate: new Date("2026-01-01"),
          monthlyRent: 1200,
          status: "Active",
        },
      });
    }
  }

  console.log("🌱 Seed completed.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

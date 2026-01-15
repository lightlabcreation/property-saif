const prisma = require("../src/config/prisma");
const bcrypt = require("bcrypt");
require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });

// Excel Data - Buildings 82-97 Mont-Tremblant
const BUILDINGS_DATA = [
  { civicNumber: "82", units: ["82-101", "82-102", "82-201", "82-202", "82-301", "82-302", "82-401", "82-402"] },
  { civicNumber: "83", units: ["83-101", "83-102", "83-201", "83-202", "83-301", "83-302", "83-401", "83-402"] },
  { civicNumber: "84", units: ["84-101", "84-102", "84-201", "84-202", "84-301", "84-302", "84-401", "84-402"] },
  { civicNumber: "85", units: ["85-101", "85-102", "85-201", "85-202", "85-301", "85-302", "85-401", "85-402"] },
  { civicNumber: "86", units: ["86-101", "86-102", "86-201", "86-202", "86-301", "86-302", "86-401", "86-402"] },
  { civicNumber: "87", units: ["87-101", "87-102", "87-201", "87-202", "87-301", "87-302", "87-401", "87-402"] },
  { civicNumber: "88", units: ["88-101", "88-102", "88-201", "88-202", "88-301", "88-302", "88-401", "88-402"] },
  { civicNumber: "89", units: ["89-101", "89-102", "89-201", "89-202", "89-301", "89-302", "89-401", "89-402"] },
  { civicNumber: "90", units: ["90-101", "90-102", "90-201", "90-202", "90-301", "90-302", "90-401", "90-402"] },
  { civicNumber: "91", units: ["91-101", "91-102", "91-201", "91-202", "91-301", "91-302", "91-401", "91-402"] },
  { civicNumber: "92", units: ["92-101", "92-102", "92-201", "92-202", "92-301", "92-302", "92-401", "92-402"] },
  { civicNumber: "93", units: ["93-101", "93-102", "93-201", "93-202", "93-301", "93-302", "93-401", "93-402"] },
  { civicNumber: "94", units: ["94-101", "94-102", "94-201", "94-202", "94-301", "94-302", "94-401", "94-402"] },
  { civicNumber: "95", units: ["95-101", "95-102", "95-201", "95-202", "95-301", "95-302", "95-401", "95-402"] },
  { civicNumber: "96", units: ["96-101", "96-102", "96-201", "96-202", "96-301", "96-302", "96-401", "96-402"] },
  { civicNumber: "97", units: ["97-101", "97-102", "97-201", "97-202", "97-301", "97-302", "97-401", "97-402"] },
];

// Unit Types from Excel
const UNIT_TYPES = ["Mackenzie", "Nelson", "Hudson", "Richelieu", "Rupert"];

// Get floor from unit number (e.g., 82-101 -> floor 1, 82-201 -> floor 2)
function getFloorFromUnitNumber(unitNumber) {
  const parts = unitNumber.split("-");
  if (parts.length === 2) {
    const unitPart = parts[1];
    return parseInt(unitPart.charAt(0)); // First digit is floor
  }
  return 1;
}

// Get unit type based on unit number pattern
function getUnitType(unitNumber) {
  const floor = getFloorFromUnitNumber(unitNumber);
  const unitPart = unitNumber.split("-")[1];
  const lastDigit = parseInt(unitPart.slice(-1));

  // Assign unit type based on pattern
  if (lastDigit === 1) return "Mackenzie";
  if (lastDigit === 2) return "Nelson";
  return UNIT_TYPES[floor % UNIT_TYPES.length];
}

// Get number of bedrooms based on unit type
function getBedroomsCount(unitType) {
  switch (unitType) {
    case "Mackenzie": return 3;
    case "Nelson": return 3;
    case "Hudson": return 2;
    case "Richelieu": return 2;
    case "Rupert": return 1;
    default: return 3;
  }
}

async function main() {
  console.log("🌱 Starting seed with Excel data...");

  const hashedPassword = await bcrypt.hash("123456", 10);

  // 1. Create Admin User
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
  console.log("✅ Admin user created");

  // 2. Create Owner User
  const owner = await prisma.user.upsert({
    where: { email: "owner@property.com" },
    update: {},
    create: {
      email: "owner@property.com",
      name: "Property Owner",
      password: hashedPassword,
      role: "OWNER",
      phone: "+1 (819) 555-0100",
    },
  });
  console.log("✅ Owner user created");

  // 3. Create Buildings (82-97) with Units and Bedrooms
  for (const buildingData of BUILDINGS_DATA) {
    const civicNumber = buildingData.civicNumber;
    const buildingName = `Building ${civicNumber}`;

    // Check if building exists
    let building = await prisma.property.findFirst({
      where: { civicNumber: civicNumber },
    });

    if (!building) {
      console.log(`📦 Creating building ${civicNumber}...`);

      building = await prisma.property.create({
        data: {
          name: buildingName,
          civicNumber: civicNumber,
          street: "Allée Marthe-Rivard",
          city: "Mont-Tremblant",
          province: "Quebec",
          postalCode: "J8E 2G5",
          address: `${civicNumber} Allée Marthe-Rivard, Mont-Tremblant, Quebec J8E 2G5`,
          status: "Active",
          ownerId: owner.id,
        },
      });

      // Create Units for this building
      for (const unitNumber of buildingData.units) {
        const floor = getFloorFromUnitNumber(unitNumber);
        const unitType = getUnitType(unitNumber);
        const bedroomsCount = getBedroomsCount(unitType);

        const unit = await prisma.unit.create({
          data: {
            name: unitNumber,
            unitNumber: unitNumber,
            unitType: unitType,
            floor: floor,
            propertyId: building.id,
            status: "Vacant",
            rentalMode: "BEDROOM_WISE",
            bedrooms: bedroomsCount,
            rentAmount: 0,
          },
        });

        // Create Bedroom records for this unit
        const bedroomsToCreate = Array.from({ length: bedroomsCount }).map((_, i) => ({
          bedroomNumber: `${unitNumber}-${i + 1}`,
          roomNumber: i + 1,
          unitId: unit.id,
          status: "Vacant",
          rentAmount: 0,
        }));

        await prisma.bedroom.createMany({
          data: bedroomsToCreate,
        });

        console.log(`  📍 Unit ${unitNumber} (${unitType}, Floor ${floor}, ${bedroomsCount} bedrooms)`);
      }
    } else {
      console.log(`⏭️ Building ${civicNumber} already exists, skipping...`);
    }
  }

  // 4. Create a sample tenant
  let tenant = await prisma.user.findUnique({
    where: { email: "tenant@example.com" },
  });
  if (!tenant) {
    tenant = await prisma.user.create({
      data: {
        email: "tenant@example.com",
        password: hashedPassword,
        name: "Jean Dupont",
        role: "TENANT",
        phone: "+1 (819) 555-0200",
        type: "Individual",
      },
    });
    console.log("✅ Sample tenant created");
  }

  console.log("\n🌱 Seed completed successfully!");
  console.log(`📊 Total Buildings: ${BUILDINGS_DATA.length}`);
  console.log(`📊 Total Units: ${BUILDINGS_DATA.length * 8}`);
  console.log(`📊 Total Bedrooms: ~${BUILDINGS_DATA.length * 8 * 3}`);
}

main()
  .catch((e) => {
    console.error("❌ Seed error:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

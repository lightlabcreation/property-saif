const { PrismaClient } = require("@prisma/client");

// Just create the client simply. No adapters, no datasources options.
const prisma = new PrismaClient();

module.exports = prisma;

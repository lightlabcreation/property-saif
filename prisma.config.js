// prisma.config.js
const { defineConfig } = require("prisma/config");
const dotenv = require("dotenv");

dotenv.config();

module.exports = defineConfig({
  datasource: {
    url: process.env.DATABASE_URL, // required for migrate dev
  },
});

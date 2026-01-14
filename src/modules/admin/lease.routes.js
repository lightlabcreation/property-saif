const express = require("express");
const router = express.Router();
const leaseController = require("./lease.controller");

router.get("/", leaseController.getLeaseHistory);
router.post("/", leaseController.createLease);
router.get("/units-with-tenants", leaseController.getUnitsWithTenants);
router.get("/active/:unitId", leaseController.getActiveLease);
router.put("/:id", leaseController.updateLease);
router.delete("/:id", leaseController.deleteLease);

module.exports = router;

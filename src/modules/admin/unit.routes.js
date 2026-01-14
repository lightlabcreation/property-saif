const express = require('express');
const router = express.Router();
const unitController = require('./unit.controller');

router.get('/', unitController.getAllUnits);
router.post('/', unitController.createUnit);
router.get('/:id', unitController.getUnitDetails);

module.exports = router;

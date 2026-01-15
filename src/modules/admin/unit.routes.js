const express = require('express');
const router = express.Router();
const unitController = require('./unit.controller');

router.get('/', unitController.getAllUnits);
router.post('/', unitController.createUnit);
router.get('/bedrooms/vacant', unitController.getVacantBedrooms);
router.get('/:id', unitController.getUnitDetails);
router.put('/:id', unitController.updateUnit);
router.delete('/:id', unitController.deleteUnit);

module.exports = router;

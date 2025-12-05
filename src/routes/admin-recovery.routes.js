const express = require('express');
const router = express.Router();
const adminRecoveryController = require('../controllers/admin-recovery.controller');

// Public route - Admin recovery (no auth required for recovery)
router.get('/instructions', adminRecoveryController.getRecoveryInstructions);
router.post('/recover', adminRecoveryController.recoverAdmin);

module.exports = router;











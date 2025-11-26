const express = require('express');
const router = express.Router();
const verificationController = require('../controllers/verification.controller');

// Public routes - No authentication required for OTP verification
router.post('/request-otp', verificationController.requestOTP);
router.post('/confirm', verificationController.confirmOTP);

module.exports = router;


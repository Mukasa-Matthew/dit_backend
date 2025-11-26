const express = require('express');
const router = express.Router();
const authController = require('../controllers/auth.controller');
const passwordResetController = require('../controllers/password-reset.controller');
const { authenticate, authorize } = require('../middleware/auth.middleware');

// Public routes
router.post('/login', authController.login);
router.post('/register', authController.register); // Candidate self-registration

// Password reset routes (public)
router.post('/forgot-password', passwordResetController.requestPasswordReset);
router.post('/verify-reset-otp', passwordResetController.verifyResetOTP);
router.post('/reset-password', passwordResetController.resetPassword);

// Protected routes
router.get('/me', authenticate, authController.getMe);
router.post('/change-password', authenticate, authController.changePassword);

module.exports = router;


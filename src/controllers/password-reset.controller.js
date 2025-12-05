const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { prisma } = require('../config/prisma');
const { logAudit } = require('../utils/auditLogger');
const { sendPasswordResetOTP } = require('../utils/emailService');

/**
 * Request password reset OTP
 * 
 * Flow:
 * 1. Candidate enters email
 * 2. System finds user (must be CANDIDATE role)
 * 3. Generates OTP
 * 4. Sends OTP via email
 * 5. Stores hashed OTP in database
 * 6. Returns success
 */
exports.requestPasswordReset = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    // Find user
    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase() }
    });

    // Don't reveal if email exists (security best practice)
    if (!user) {
      // Still return success to prevent email enumeration
      return res.json({
        message: 'If an account with that email exists, a password reset code has been sent.',
      });
    }

    // Only allow password reset for CANDIDATE role
    if (user.role !== 'CANDIDATE') {
      return res.json({
        message: 'If an account with that email exists, a password reset code has been sent.',
      });
    }

    // Check if user is active
    if (user.status !== 'ACTIVE') {
      return res.status(400).json({ error: 'Account is inactive. Please contact administrator.' });
    }

    // Check for recent password reset request (rate limiting)
    const recentReset = await prisma.passwordReset.findFirst({
      where: {
        userId: user.id,
        issuedAt: {
          gte: new Date(Date.now() - 2 * 60 * 1000), // Last 2 minutes
        },
        consumedAt: null, // Not yet consumed
      },
      orderBy: {
        issuedAt: 'desc',
      },
    });

    if (recentReset) {
      return res.status(429).json({
        error: 'Please wait before requesting another password reset code',
        retryAfter: 120, // seconds
      });
    }

    // Generate 6-digit OTP
    const otp = crypto.randomInt(100000, 999999).toString();
    const otpHash = await bcrypt.hash(otp, 10);

    // Set expiration (5 minutes)
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

    // Store OTP in database
    const passwordReset = await prisma.passwordReset.create({
      data: {
        userId: user.id,
        otpHash,
        expiresAt,
      },
    });

    // Send OTP via email
    try {
      await sendPasswordResetOTP(user.email, otp, user.name);
    } catch (emailError) {
      console.error('Failed to send password reset OTP email:', emailError);
      // Delete the password reset record if email fails
      await prisma.passwordReset.delete({
        where: { id: passwordReset.id }
      });
      
      // Don't fail the request, but log it
      await logAudit({
        actorType: 'system',
        action: 'PASSWORD_RESET_EMAIL_FAILED',
        entity: 'password_reset',
        entityId: passwordReset.id,
        payload: { userId: user.id, error: emailError.message },
      });
      
      return res.status(500).json({
        error: 'Failed to send password reset email. Please try again later.',
      });
    }

    // Log audit
    await logAudit({
      actorType: 'candidate',
      actorId: user.id,
      action: 'PASSWORD_RESET_REQUESTED',
      entity: 'password_reset',
      entityId: passwordReset.id,
      payload: {
        email: user.email,
        method: 'email',
      },
    });

    res.json({
      message: 'If an account with that email exists, a password reset code has been sent.',
      expiresIn: 300, // 5 minutes in seconds
    });
  } catch (error) {
    console.error('Request password reset error:', error);
    res.status(500).json({ error: 'Failed to request password reset' });
  }
};

/**
 * Verify password reset OTP
 * 
 * Flow:
 * 1. Candidate enters email and OTP
 * 2. System verifies OTP
 * 3. Returns success with reset token
 */
exports.verifyResetOTP = async (req, res) => {
  try {
    const { email, otp } = req.body;

    if (!email || !otp) {
      return res.status(400).json({ error: 'Email and OTP are required' });
    }

    // Find user
    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase() }
    });

    if (!user) {
      return res.status(404).json({ error: 'Invalid email or OTP' });
    }

    // Only allow for CANDIDATE role
    if (user.role !== 'CANDIDATE') {
      return res.status(403).json({ error: 'Password reset is only available for candidates' });
    }

    // Find most recent unverified password reset
    const passwordReset = await prisma.passwordReset.findFirst({
      where: {
        userId: user.id,
        verifiedAt: null,
        consumedAt: null,
      },
      orderBy: {
        issuedAt: 'desc',
      },
    });

    if (!passwordReset) {
      return res.status(400).json({ error: 'No password reset request found. Please request a new code.' });
    }

    // Check if OTP is expired
    if (new Date() > passwordReset.expiresAt) {
      return res.status(400).json({ error: 'Password reset code has expired. Please request a new one.' });
    }

    // Verify OTP
    const validOTP = await bcrypt.compare(otp, passwordReset.otpHash);
    if (!validOTP) {
      return res.status(400).json({ error: 'Invalid OTP code' });
    }

    // Mark OTP as verified
    await prisma.passwordReset.update({
      where: { id: passwordReset.id },
      data: {
        verifiedAt: new Date(),
      },
    });

    // Generate reset token (for frontend to use in next step)
    const resetToken = crypto.randomBytes(32).toString('hex');

    // Store reset token (we'll use the passwordReset id as the token identifier)
    // In a production system, you might want to store this in a separate table
    // For simplicity, we'll use the passwordReset id as the token

    // Log audit
    await logAudit({
      actorType: 'candidate',
      actorId: user.id,
      action: 'PASSWORD_RESET_OTP_VERIFIED',
      entity: 'password_reset',
      entityId: passwordReset.id,
      payload: {
        email: user.email,
      },
    });

    res.json({
      message: 'OTP verified successfully. You can now reset your password.',
      resetToken: passwordReset.id, // Use the ID as the reset token
    });
  } catch (error) {
    console.error('Verify reset OTP error:', error);
    res.status(500).json({ error: 'Failed to verify OTP' });
  }
};

/**
 * Reset password
 * 
 * Flow:
 * 1. Candidate enters reset token and new password
 * 2. System verifies reset token
 * 3. Updates password
 * 4. Marks reset as consumed
 */
exports.resetPassword = async (req, res) => {
  try {
    const { resetToken, newPassword } = req.body;

    if (!resetToken || !newPassword) {
      return res.status(400).json({ error: 'Reset token and new password are required' });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    // Find password reset record
    const passwordReset = await prisma.passwordReset.findUnique({
      where: { id: resetToken },
      include: {
        user: true,
      },
    });

    if (!passwordReset) {
      return res.status(400).json({ error: 'Invalid or expired reset token' });
    }

    // Check if already consumed
    if (passwordReset.consumedAt) {
      return res.status(400).json({ error: 'This password reset link has already been used' });
    }

    // Check if OTP was verified
    if (!passwordReset.verifiedAt) {
      return res.status(400).json({ error: 'OTP not verified. Please verify OTP first.' });
    }

    // Check if expired
    if (new Date() > passwordReset.expiresAt) {
      return res.status(400).json({ error: 'Password reset code has expired. Please request a new one.' });
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(newPassword, 12);

    // Update user password
    await prisma.user.update({
      where: { id: passwordReset.userId },
      data: { password: hashedPassword },
    });

    // Mark reset as consumed
    await prisma.passwordReset.update({
      where: { id: passwordReset.id },
      data: {
        consumedAt: new Date(),
        resetAt: new Date(),
      },
    });

    // Log audit
    await logAudit({
      actorType: 'candidate',
      actorId: passwordReset.userId,
      action: 'PASSWORD_RESET_COMPLETED',
      entity: 'user',
      entityId: passwordReset.userId,
      payload: {
        email: passwordReset.user.email,
      },
    });

    res.json({
      message: 'Password reset successfully. You can now log in with your new password.',
    });
  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({ error: 'Failed to reset password' });
  }
};










const bcrypt = require('bcryptjs');
const { prisma } = require('../config/prisma');
const { logAudit } = require('../utils/auditLogger');
require('dotenv').config();

/**
 * Admin Account Recovery
 * 
 * This allows recovery of admin account using credentials from .env file
 * This is a secure recovery mechanism that:
 * 1. Verifies recovery token (from .env ADMIN_RECOVERY_TOKEN)
 * 2. Resets admin password from ADMIN_PASSWORD in .env
 * 3. Logs all recovery attempts
 * 
 * Usage:
 * POST /api/admin/recover
 * Body: { recoveryToken: "your-recovery-token-from-env" }
 */
exports.recoverAdmin = async (req, res) => {
  try {
    const { recoveryToken } = req.body;

    // Get recovery token from .env
    const validRecoveryToken = process.env.ADMIN_RECOVERY_TOKEN || 'DEFAULT_RECOVERY_TOKEN_CHANGE_ME';

    // Verify recovery token
    if (!recoveryToken || recoveryToken !== validRecoveryToken) {
      // Log failed attempt
      await logAudit({
        actorType: 'system',
        action: 'ADMIN_RECOVERY_ATTEMPT_FAILED',
        entity: 'user',
        payload: { 
          reason: 'Invalid recovery token',
          ip: req.ip,
          userAgent: req.get('user-agent'),
        },
      });

      return res.status(401).json({ 
        error: 'Invalid recovery token',
        hint: 'Check ADMIN_RECOVERY_TOKEN in .env file',
      });
    }

    // Get admin credentials from .env
    const adminEmail = process.env.ADMIN_EMAIL;
    const adminPassword = process.env.ADMIN_PASSWORD;
    const adminName = process.env.ADMIN_NAME || 'Election Administrator';

    if (!adminEmail || !adminPassword) {
      return res.status(500).json({ 
        error: 'Admin credentials not configured',
        hint: 'ADMIN_EMAIL and ADMIN_PASSWORD must be set in .env',
      });
    }

    // Find or create admin user
    const hashedPassword = await bcrypt.hash(adminPassword, 12);
    
    const admin = await prisma.user.upsert({
      where: { email: adminEmail.toLowerCase() },
      update: {
        password: hashedPassword,
        name: adminName,
        status: 'ACTIVE',
        emailVerified: true,
        role: 'ADMIN', // Ensure role is ADMIN
      },
      create: {
        email: adminEmail.toLowerCase(),
        password: hashedPassword,
        name: adminName,
        role: 'ADMIN',
        status: 'ACTIVE',
        emailVerified: true,
      },
    });

    // Log successful recovery
    await logAudit({
      actorType: 'system',
      action: 'ADMIN_RECOVERY_SUCCESS',
      entity: 'user',
      entityId: admin.id,
      payload: { 
        adminEmail: admin.email,
        ip: req.ip,
        userAgent: req.get('user-agent'),
      },
    });

    res.json({
      message: 'Admin account recovered successfully',
      admin: {
        email: admin.email,
        name: admin.name,
        role: admin.role,
      },
      credentials: {
        email: adminEmail,
        password: '[Set in ADMIN_PASSWORD in .env]',
      },
      note: 'You can now log in with the credentials from your .env file',
    });
  } catch (error) {
    console.error('Admin recovery error:', error);
    
    // Log error
    await logAudit({
      actorType: 'system',
      action: 'ADMIN_RECOVERY_ERROR',
      entity: 'system',
      payload: { 
        error: error.message,
        ip: req.ip,
      },
    });

    res.status(500).json({ error: 'Failed to recover admin account' });
  }
};

/**
 * Get admin recovery instructions
 * This endpoint provides instructions on how to recover admin account
 */
exports.getRecoveryInstructions = async (req, res) => {
  res.json({
    instructions: {
      step1: 'Ensure ADMIN_EMAIL, ADMIN_PASSWORD, and ADMIN_RECOVERY_TOKEN are set in .env file',
      step2: 'Call POST /api/admin/recover with recoveryToken in request body',
      step3: 'Admin account will be reset to credentials from .env',
      step4: 'Log in with ADMIN_EMAIL and ADMIN_PASSWORD',
    },
    security: {
      note: 'Recovery token should be a strong random string',
      example: 'ADMIN_RECOVERY_TOKEN=your-strong-random-token-here',
      warning: 'Never commit .env file to version control',
    },
    alternative: {
      method: 'Run seed script',
      command: 'npm run prisma:seed',
      description: 'This will also reset admin account from .env credentials',
    },
  });
};











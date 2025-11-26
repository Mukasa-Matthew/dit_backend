const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { prisma } = require('../config/prisma');
const { logAudit } = require('../utils/auditLogger');

// Login
exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;

    console.log(`Login attempt for: ${email}`);

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    // Find user (optimized query - only select needed fields)
    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase() },
      select: {
        id: true,
        email: true,
        password: true,
        name: true,
        role: true,
        status: true,
      }
    });

    if (!user) {
      console.log(`Login failed: User not found for email: ${email}`);
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Check if user is active
    if (user.status !== 'ACTIVE') {
      console.log(`Login failed: Account inactive for email: ${email}, status: ${user.status}`);
      return res.status(401).json({ error: 'Account is inactive' });
    }

    // Verify password
    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      console.log(`Login failed: Invalid password for email: ${email}`);
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Check JWT_SECRET is set
    if (!process.env.JWT_SECRET) {
      console.error('JWT_SECRET is not set in environment variables');
      return res.status(500).json({ error: 'Server configuration error' });
    }

    // Generate JWT token
    const token = jwt.sign(
      { userId: user.id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '24h' }
    );

    console.log(`Login successful for: ${email}, role: ${user.role}`);

    // Log audit (non-blocking - don't wait for it)
    logAudit({
      actorType: user.role.toLowerCase(),
      actorId: user.id,
      action: 'LOGIN',
      entity: 'user',
      entityId: user.id
    }).catch(err => console.error('Audit log error (non-critical):', err));

    // Return token and user info (excluding password) immediately
    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        status: user.status
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
};

// Candidate self-registration
exports.register = async (req, res) => {
  try {
    const { email, password, name, regNo, program } = req.body;

    if (!email || !password || !name || !regNo || !program) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    // Check if email already exists (optimized - only check id)
    const existingUser = await prisma.user.findUnique({
      where: { email: email.toLowerCase() },
      select: { id: true }
    });

    if (existingUser) {
      return res.status(400).json({ error: 'Email already registered' });
    }

    // Hash password (using 10 rounds for faster hashing while maintaining security)
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create user
    const user = await prisma.user.create({
      data: {
        email: email.toLowerCase(),
        password: hashedPassword,
        name,
        regNo,
        program,
        role: 'CANDIDATE',
        status: 'ACTIVE',
        emailVerified: false
      },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        regNo: true,
        program: true
      }
    });

    // Log audit (non-blocking - don't wait for it)
    logAudit({
      actorType: 'candidate',
      actorId: user.id,
      action: 'REGISTER',
      entity: 'user',
      entityId: user.id,
      payload: { email, name, regNo, program }
    }).catch(err => console.error('Audit log error (non-critical):', err));

    res.status(201).json({
      message: 'Registration successful',
      user
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Registration failed' });
  }
};

// Get current user
exports.getMe = async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        regNo: true,
        program: true,
        staffId: true,
        status: true,
        emailVerified: true,
        createdAt: true
      }
    });

    res.json({ user });
  } catch (error) {
    console.error('Get me error:', error);
    res.status(500).json({ error: 'Failed to get user info' });
  }
};

// Change password
exports.changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Current and new passwords are required' });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ error: 'New password must be at least 6 characters' });
    }

    // Get user with password
    const user = await prisma.user.findUnique({
      where: { id: req.user.id }
    });

    // Verify current password
    const validPassword = await bcrypt.compare(currentPassword, user.password);
    if (!validPassword) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }

    // Hash new password (using 10 rounds for faster hashing while maintaining security)
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    // Update password
    await prisma.user.update({
      where: { id: user.id },
      data: { password: hashedPassword }
    });

    // Log audit
    await logAudit({
      actorType: user.role.toLowerCase(),
      actorId: user.id,
      action: 'CHANGE_PASSWORD',
      entity: 'user',
      entityId: user.id
    });

    res.json({ message: 'Password changed successfully' });
  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json({ error: 'Failed to change password' });
  }
};


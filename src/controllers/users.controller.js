const bcrypt = require('bcryptjs');
const { prisma } = require('../config/prisma');
const { logAudit } = require('../utils/auditLogger');

// Get all users (Admin only)
exports.getAllUsers = async (req, res) => {
  try {
    const users = await prisma.user.findMany({
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
        createdAt: true,
        updatedAt: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    res.json(users);
  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
};

// Create user (Admin only)
exports.createUser = async (req, res) => {
  try {
    const { email, password, name, role, regNo, program, staffId } = req.body;

    // Validation
    if (!email || !password || !name || !role) {
      return res.status(400).json({ error: 'Email, password, name, and role are required' });
    }

    // Validate role
    if (!['ADMIN', 'OFFICER', 'CANDIDATE'].includes(role)) {
      return res.status(400).json({ error: 'Invalid role. Must be ADMIN, OFFICER, or CANDIDATE' });
    }

    // Check if email already exists
    const existingUser = await prisma.user.findUnique({
      where: { email: email.toLowerCase() },
    });

    if (existingUser) {
      return res.status(400).json({ error: 'Email already registered' });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 12);

    // Create user
    const user = await prisma.user.create({
      data: {
        email: email.toLowerCase(),
        password: hashedPassword,
        name,
        role,
        regNo: regNo || null,
        program: program || null,
        staffId: staffId || null,
        status: 'ACTIVE',
        emailVerified: true,
        createdBy: req.user.id, // Admin who created this user
      },
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
        createdAt: true,
      },
    });

    // Log audit
    await logAudit({
      actorType: 'admin',
      actorId: req.user.id,
      action: 'CREATE_USER',
      entity: 'user',
      entityId: user.id,
      payload: { email, name, role, regNo, program, staffId },
    });

    res.status(201).json({
      message: 'User created successfully',
      user,
    });
  } catch (error) {
    console.error('Create user error:', error);
    res.status(500).json({ error: 'Failed to create user' });
  }
};

// Update user (Admin only)
exports.updateUser = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, role, regNo, program, staffId, status, emailVerified } = req.body;

    // Check if user exists
    const existingUser = await prisma.user.findUnique({
      where: { id },
    });

    if (!existingUser) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Don't allow changing admin role if it's the only admin
    if (existingUser.role === 'ADMIN' && role !== 'ADMIN') {
      const adminCount = await prisma.user.count({
        where: { role: 'ADMIN' },
      });
      if (adminCount === 1) {
        return res.status(400).json({ error: 'Cannot change role of the only admin user' });
      }
    }

    // Update user
    const user = await prisma.user.update({
      where: { id },
      data: {
        ...(name && { name }),
        ...(role && { role }),
        ...(regNo !== undefined && { regNo }),
        ...(program !== undefined && { program }),
        ...(staffId !== undefined && { staffId }),
        ...(status && { status }),
        ...(emailVerified !== undefined && { emailVerified }),
      },
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
        updatedAt: true,
      },
    });

    // Log audit
    await logAudit({
      actorType: 'admin',
      actorId: req.user.id,
      action: 'UPDATE_USER',
      entity: 'user',
      entityId: user.id,
      payload: { name, role, regNo, program, staffId, status, emailVerified },
    });

    res.json({
      message: 'User updated successfully',
      user,
    });
  } catch (error) {
    console.error('Update user error:', error);
    res.status(500).json({ error: 'Failed to update user' });
  }
};

// Delete user (Admin only)
exports.deleteUser = async (req, res) => {
  try {
    const { id } = req.params;

    // Check if user exists
    const user = await prisma.user.findUnique({
      where: { id },
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Don't allow deleting admin users
    if (user.role === 'ADMIN') {
      return res.status(400).json({ error: 'Cannot delete admin users' });
    }

    // Delete user
    await prisma.user.delete({
      where: { id },
    });

    // Log audit
    await logAudit({
      actorType: 'admin',
      actorId: req.user.id,
      action: 'DELETE_USER',
      entity: 'user',
      entityId: id,
      payload: { email: user.email, role: user.role },
    });

    res.json({ message: 'User deleted successfully' });
  } catch (error) {
    console.error('Delete user error:', error);
    res.status(500).json({ error: 'Failed to delete user' });
  }
};

// Activate user (Admin only)
exports.activateUser = async (req, res) => {
  try {
    const { id } = req.params;

    // Check if user exists
    const user = await prisma.user.findUnique({
      where: { id },
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Don't allow activating/deactivating admin users
    if (user.role === 'ADMIN') {
      return res.status(400).json({ error: 'Cannot activate/deactivate admin users' });
    }

    // Update status to ACTIVE
    const updatedUser = await prisma.user.update({
      where: { id },
      data: {
        status: 'ACTIVE',
      },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        status: true,
      },
    });

    // Log audit
    await logAudit({
      actorType: 'admin',
      actorId: req.user.id,
      action: 'ACTIVATE_USER',
      entity: 'user',
      entityId: id,
      payload: { 
        email: user.email, 
        role: user.role,
        previousStatus: user.status,
        newStatus: 'ACTIVE',
      },
    });

    res.json({
      message: 'User activated successfully',
      user: updatedUser,
    });
  } catch (error) {
    console.error('Activate user error:', error);
    res.status(500).json({ error: 'Failed to activate user' });
  }
};

// Deactivate user (Admin only)
exports.deactivateUser = async (req, res) => {
  try {
    const { id } = req.params;

    // Check if user exists
    const user = await prisma.user.findUnique({
      where: { id },
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Don't allow activating/deactivating admin users
    if (user.role === 'ADMIN') {
      return res.status(400).json({ error: 'Cannot activate/deactivate admin users' });
    }

    // Update status to INACTIVE
    const updatedUser = await prisma.user.update({
      where: { id },
      data: {
        status: 'INACTIVE',
      },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        status: true,
      },
    });

    // Log audit
    await logAudit({
      actorType: 'admin',
      actorId: req.user.id,
      action: 'DEACTIVATE_USER',
      entity: 'user',
      entityId: id,
      payload: { 
        email: user.email, 
        role: user.role,
        previousStatus: user.status,
        newStatus: 'INACTIVE',
      },
    });

    res.json({
      message: 'User deactivated successfully',
      user: updatedUser,
    });
  } catch (error) {
    console.error('Deactivate user error:', error);
    res.status(500).json({ error: 'Failed to deactivate user' });
  }
};

// Get user by ID (Admin only)
exports.getUserById = async (req, res) => {
  try {
    const { id } = req.params;

    const user = await prisma.user.findUnique({
      where: { id },
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
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json(user);
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ error: 'Failed to fetch user' });
  }
};


const { prisma } = require('../config/prisma');
const { logAudit } = require('../utils/auditLogger');

// Helper function to parse dates consistently
// Dates from datetime-local inputs are in format "YYYY-MM-DDTHH:mm" (no timezone)
// We treat them as UTC to avoid timezone conversion issues
const parseDate = (dateString) => {
  if (!dateString) return new Date(dateString);
  // If date string doesn't have timezone, append 'Z' to treat as UTC
  if (!dateString.includes('Z') && !dateString.match(/[+-]\d{2}:\d{2}$/)) {
    // Add seconds if missing and append Z for UTC
    const normalized = dateString.includes(':') && dateString.split(':').length === 2 
      ? `${dateString}:00Z` 
      : `${dateString}Z`;
    return new Date(normalized);
  }
  return new Date(dateString);
};

// Get all positions
exports.getAllPositions = async (req, res) => {
  try {
    const positions = await prisma.position.findMany({
      orderBy: {
        createdAt: 'desc',
      },
      include: {
        _count: {
          select: {
            candidates: true,
            votes: true,
          },
        },
      },
    });

    res.json(positions);
  } catch (error) {
    console.error('Get positions error:', error);
    res.status(500).json({ error: 'Failed to fetch positions' });
  }
};

// Get position by ID
exports.getPositionById = async (req, res) => {
  try {
    const { id } = req.params;

    const position = await prisma.position.findUnique({
      where: { id },
      include: {
        candidates: {
          include: {
            user: {
              select: {
                id: true,
                email: true,
                name: true,
              },
            },
          },
        },
        _count: {
          select: {
            votes: true,
          },
        },
      },
    });

    if (!position) {
      return res.status(404).json({ error: 'Position not found' });
    }

    res.json(position);
  } catch (error) {
    console.error('Get position error:', error);
    res.status(500).json({ error: 'Failed to fetch position' });
  }
};

/**
 * Create position (Admin only)
 * 
 * SECURITY: Positions can ONLY be created by ADMIN users via the admin dashboard.
 * This endpoint is protected by:
 * 1. Authentication middleware (requires valid JWT token)
 * 2. Authorization middleware (requires ADMIN role)
 * 3. All position creation is logged in audit log
 * 
 * No other method (seed files, direct DB access, etc.) should create positions.
 */
exports.createPosition = async (req, res) => {
  try {
    // Double-check admin role (additional security layer)
    if (req.user.role !== 'ADMIN') {
      return res.status(403).json({ error: 'Only administrators can create positions' });
    }

    const { name, seats, nominationOpens, nominationCloses, votingOpens, votingCloses } = req.body;

    // Validation
    if (!name || !seats || !nominationOpens || !nominationCloses || !votingOpens || !votingCloses) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    // Validate dates
    const nomOpen = parseDate(nominationOpens);
    const nomClose = parseDate(nominationCloses);
    const voteOpen = parseDate(votingOpens);
    const voteClose = parseDate(votingCloses);

    if (nomClose <= nomOpen) {
      return res.status(400).json({ error: 'Nomination close date must be after open date' });
    }

    if (voteClose <= voteOpen) {
      return res.status(400).json({ error: 'Voting close date must be after open date' });
    }

    if (voteOpen < nomClose) {
      return res.status(400).json({ error: 'Voting period must start after nomination period ends' });
    }

    // Create position
    const position = await prisma.position.create({
      data: {
        name,
        seats: parseInt(seats),
        nominationOpens: nomOpen,
        nominationCloses: nomClose,
        votingOpens: voteOpen,
        votingCloses: voteClose,
      },
    });

    // Log audit
    await logAudit({
      actorType: 'admin',
      actorId: req.user.id,
      action: 'CREATE_POSITION',
      entity: 'position',
      entityId: position.id,
      payload: { name, seats, nominationOpens, nominationCloses, votingOpens, votingCloses },
    });

    res.status(201).json({
      message: 'Position created successfully',
      position,
    });
  } catch (error) {
    console.error('Create position error:', error);
    res.status(500).json({ error: 'Failed to create position' });
  }
};

// Update position (Admin only)
exports.updatePosition = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, seats, nominationOpens, nominationCloses, votingOpens, votingCloses } = req.body;

    // Check if position exists
    const existingPosition = await prisma.position.findUnique({
      where: { id },
    });

    if (!existingPosition) {
      return res.status(404).json({ error: 'Position not found' });
    }

    // Validate dates if provided
    if (nominationOpens && nominationCloses) {
      const nomOpen = parseDate(nominationOpens);
      const nomClose = parseDate(nominationCloses);
      if (nomClose <= nomOpen) {
        return res.status(400).json({ error: 'Nomination close date must be after open date' });
      }
    }

    if (votingOpens && votingCloses) {
      const voteOpen = parseDate(votingOpens);
      const voteClose = parseDate(votingCloses);
      if (voteClose <= voteOpen) {
        return res.status(400).json({ error: 'Voting close date must be after open date' });
      }
    }

    // Update position
    const position = await prisma.position.update({
      where: { id },
      data: {
        ...(name && { name }),
        ...(seats && { seats: parseInt(seats) }),
        ...(nominationOpens && { nominationOpens: parseDate(nominationOpens) }),
        ...(nominationCloses && { nominationCloses: parseDate(nominationCloses) }),
        ...(votingOpens && { votingOpens: parseDate(votingOpens) }),
        ...(votingCloses && { votingCloses: parseDate(votingCloses) }),
      },
    });

    // Log audit
    await logAudit({
      actorType: 'admin',
      actorId: req.user.id,
      action: 'UPDATE_POSITION',
      entity: 'position',
      entityId: position.id,
      payload: { name, seats, nominationOpens, nominationCloses, votingOpens, votingCloses },
    });

    res.json({
      message: 'Position updated successfully',
      position,
    });
  } catch (error) {
    console.error('Update position error:', error);
    res.status(500).json({ error: 'Failed to update position' });
  }
};

// Delete position (Admin only)
exports.deletePosition = async (req, res) => {
  try {
    const { id } = req.params;

    // Check if position exists
    const position = await prisma.position.findUnique({
      where: { id },
      include: {
        _count: {
          select: {
            candidates: true,
            votes: true,
          },
        },
      },
    });

    if (!position) {
      return res.status(404).json({ error: 'Position not found' });
    }

    // Prevent deletion if there are candidates or votes
    if (position._count.candidates > 0) {
      return res.status(400).json({ error: 'Cannot delete position with existing candidates' });
    }

    if (position._count.votes > 0) {
      return res.status(400).json({ error: 'Cannot delete position with existing votes' });
    }

    // Delete position
    await prisma.position.delete({
      where: { id },
    });

    // Log audit
    await logAudit({
      actorType: 'admin',
      actorId: req.user.id,
      action: 'DELETE_POSITION',
      entity: 'position',
      entityId: id,
      payload: { name: position.name },
    });

    res.json({ message: 'Position deleted successfully' });
  } catch (error) {
    console.error('Delete position error:', error);
    res.status(500).json({ error: 'Failed to delete position' });
  }
};

// Get open positions (for candidates to nominate)
exports.getOpenPositions = async (req, res) => {
  try {
    const now = new Date();
    
    // Get all positions
    const allPositions = await prisma.position.findMany({
      orderBy: {
        nominationCloses: 'asc',
      },
    });

    // Filter positions where nomination window is currently open
    // Use timestamp comparison to avoid timezone issues
    const openPositions = allPositions.filter((position) => {
      const nomOpens = new Date(position.nominationOpens);
      const nomCloses = new Date(position.nominationCloses);
      
      // Compare timestamps directly
      const nowTime = now.getTime();
      const opensTime = nomOpens.getTime();
      const closesTime = nomCloses.getTime();
      
      return nowTime >= opensTime && nowTime <= closesTime;
    });

    res.json(openPositions);
  } catch (error) {
    console.error('Get open positions error:', error);
    res.status(500).json({ error: 'Failed to fetch open positions' });
  }
};

// Extend time windows for a position (Admin only)
exports.extendTime = async (req, res) => {
  try {
    const { id } = req.params;
    const { extendNominationHours, extendVotingHours } = req.body;

    // Check if position exists
    const position = await prisma.position.findUnique({
      where: { id },
    });

    if (!position) {
      return res.status(404).json({ error: 'Position not found' });
    }

    // Validate extension values
    if (extendNominationHours === undefined && extendVotingHours === undefined) {
      return res.status(400).json({ error: 'At least one extension value is required (extendNominationHours or extendVotingHours)' });
    }

    const updateData = {};

    // Extend nomination window if specified
    if (extendNominationHours !== undefined) {
      const hours = parseFloat(extendNominationHours);
      if (isNaN(hours) || hours <= 0) {
        return res.status(400).json({ error: 'extendNominationHours must be a positive number' });
      }
      const newCloseDate = new Date(position.nominationCloses);
      newCloseDate.setHours(newCloseDate.getHours() + hours);
      updateData.nominationCloses = newCloseDate;
    }

    // Extend voting window if specified
    if (extendVotingHours !== undefined) {
      const hours = parseFloat(extendVotingHours);
      if (isNaN(hours) || hours <= 0) {
        return res.status(400).json({ error: 'extendVotingHours must be a positive number' });
      }
      const newCloseDate = new Date(position.votingCloses);
      newCloseDate.setHours(newCloseDate.getHours() + hours);
      updateData.votingCloses = newCloseDate;
    }

    // Validate that nomination closes before voting opens (if both are being updated)
    const finalNomClose = updateData.nominationCloses || position.nominationCloses;
    const finalVoteOpen = position.votingOpens;
    if (finalNomClose > finalVoteOpen) {
      return res.status(400).json({ 
        error: 'Nomination period cannot extend beyond voting start date. Please extend voting window as well.' 
      });
    }

    // Update position
    const updated = await prisma.position.update({
      where: { id },
      data: updateData,
    });

    // Log audit
    await logAudit({
      actorType: 'admin',
      actorId: req.user.id,
      action: 'EXTEND_POSITION_TIME',
      entity: 'position',
      entityId: position.id,
      payload: { 
        positionName: position.name,
        extendNominationHours: extendNominationHours || null,
        extendVotingHours: extendVotingHours || null,
        newNominationCloses: updateData.nominationCloses || null,
        newVotingCloses: updateData.votingCloses || null,
      },
    });

    res.json({
      message: 'Time windows extended successfully',
      position: updated,
    });
  } catch (error) {
    console.error('Extend time error:', error);
    res.status(500).json({ error: 'Failed to extend time windows' });
  }
};


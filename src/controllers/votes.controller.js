const { prisma } = require('../config/prisma');
const { logAudit } = require('../utils/auditLogger');

// Helper function to parse dates consistently (same as positions controller)
const parseDate = (dateString) => {
  if (!dateString) return null;
  // If date string doesn't have timezone, create Date object directly
  // This will interpret the string as local time, which is what datetime-local inputs provide
  if (!dateString.includes('Z') && !dateString.match(/[+-]\d{2}:\d{2}$/)) {
    return new Date(dateString);
  }
  // If it has timezone info, parse it as is
  return new Date(dateString);
};

/**
 * Get ballot data (positions and candidates)
 * Uses ballot token to verify voter and get voting data
 */
exports.getBallot = async (req, res) => {
  try {
    // Get token from query or header
    const token = req.query.token || req.headers['x-ballot-token'];
    
    if (!token) {
      return res.status(400).json({ error: 'Ballot token is required' });
    }

    // Find ballot by token
    const ballot = await prisma.ballot.findUnique({
      where: { token },
      include: {
        voter: {
          select: {
            id: true,
            regNo: true,
            name: true,
          },
        },
      },
    });

    if (!ballot) {
      return res.status(404).json({ error: 'Invalid ballot token' });
    }

    if (ballot.status === 'CONSUMED') {
      return res.status(400).json({ 
        error: 'This ballot has already been used',
        hint: 'You can only vote once',
      });
    }

    // Get all positions with open voting windows
    // Use parseDate to ensure consistent local time comparison
    const now = parseDate(new Date().toISOString().slice(0, 16)); // Get current local time string (YYYY-MM-DDTHH:mm)
    console.log('Backend getBallot - now (Local Time):', now.toISOString());
    
    const positions = await prisma.position.findMany({
      where: {
        votingOpens: {
          lte: now,
        },
        votingCloses: {
          gte: now,
        },
      },
      orderBy: {
        name: 'asc',
      },
    });
    
    console.log(`Backend getBallot - found ${positions.length} open positions for voting`);
    if (positions.length > 0) {
      console.log('Sample position:', {
        name: positions[0].name,
        votingOpens: positions[0].votingOpens.toISOString(),
        votingCloses: positions[0].votingCloses.toISOString(),
      });
    }

    // Get all approved candidates for these positions
    const positionIds = positions.map((p) => p.id);
    const candidates = await prisma.candidate.findMany({
      where: {
        positionId: {
          in: positionIds,
        },
        status: 'APPROVED',
      },
      include: {
        position: {
          select: {
            id: true,
            name: true,
          },
        },
      },
      orderBy: {
        name: 'asc',
      },
    });
    
    console.log(`Backend getBallot - found ${candidates.length} approved candidates`);
    if (candidates.length > 0) {
      console.log('Sample candidate:', {
        name: candidates[0].name,
        position: candidates[0].position.name,
        status: candidates[0].status,
      });
    } else if (positions.length > 0) {
      console.warn('⚠️ Positions found but no approved candidates!');
      // Check if there are any candidates (approved or not) for debugging
      const allCandidates = await prisma.candidate.findMany({
        where: {
          positionId: {
            in: positionIds,
          },
        },
        select: {
          id: true,
          name: true,
          status: true,
          position: {
            select: { name: true },
          },
        },
      });
      console.log(`Total candidates (all statuses): ${allCandidates.length}`);
      if (allCandidates.length > 0) {
        const statusCounts = allCandidates.reduce((acc, c) => {
          acc[c.status] = (acc[c.status] || 0) + 1;
          return acc;
        }, {});
        console.log('Candidate status breakdown:', statusCounts);
      }
    }

    res.json({
      ballot: {
        id: ballot.id,
        status: ballot.status,
        issuedAt: ballot.issuedAt,
      },
      positions,
      candidates,
    });
  } catch (error) {
    console.error('Get ballot error:', error);
    res.status(500).json({ error: 'Failed to fetch ballot' });
  }
};

/**
 * Cast vote
 * Records votes for positions using ballot token
 */
exports.castVote = async (req, res) => {
  try {
    const { token, votes } = req.body;

    if (!token) {
      return res.status(400).json({ error: 'Ballot token is required' });
    }

    if (!votes || !Array.isArray(votes) || votes.length === 0) {
      return res.status(400).json({ error: 'Votes are required' });
    }

    // Find ballot by token
    const ballot = await prisma.ballot.findUnique({
      where: { token },
      include: {
        voter: {
          select: {
            id: true,
            regNo: true,
          },
        },
      },
    });

    if (!ballot) {
      return res.status(404).json({ error: 'Invalid ballot token' });
    }

    if (ballot.status === 'CONSUMED') {
      return res.status(400).json({ 
        error: 'This ballot has already been used',
        hint: 'You can only vote once',
      });
    }

    // Validate voting window is still open
    // Use parseDate to ensure consistent local time comparison
    const now = parseDate(new Date().toISOString().slice(0, 16)); // Get current local time string
    const positions = await prisma.position.findMany({
      where: {
        id: {
          in: votes.map((v) => v.positionId),
        },
        votingOpens: {
          lte: now,
        },
        votingCloses: {
          gte: now,
        },
      },
    });

    if (positions.length !== votes.length) {
      // Get position names that are not open
      const allPositions = await prisma.position.findMany({
        where: {
          id: { in: votes.map((v) => v.positionId) },
        },
        select: { id: true, name: true, votingOpens: true, votingCloses: true },
      });
      
      const closedPositions = allPositions.filter((p) => {
        const now = new Date();
        return now < p.votingOpens || now > p.votingCloses;
      });
      
      return res.status(400).json({ 
        error: 'Some positions are not open for voting',
        hint: closedPositions.length > 0 
          ? `Voting window closed for: ${closedPositions.map(p => p.name).join(', ')}`
          : 'Voting window may have closed. Contact administrator to extend voting time.',
        closedPositions: closedPositions.map(p => ({
          name: p.name,
          votingOpens: p.votingOpens,
          votingCloses: p.votingCloses,
        })),
      });
    }

    // Validate candidates exist and are approved
    const candidateIds = votes.map((v) => v.candidateId);
    const candidates = await prisma.candidate.findMany({
      where: {
        id: {
          in: candidateIds,
        },
        status: 'APPROVED',
      },
    });

    if (candidates.length !== votes.length) {
      return res.status(400).json({ error: 'Some candidates are invalid or not approved' });
    }

    // Validate one vote per position
    const positionIds = votes.map((v) => v.positionId);
    const uniquePositions = new Set(positionIds);
    if (uniquePositions.size !== positionIds.length) {
      return res.status(400).json({ error: 'Cannot vote multiple times for the same position' });
    }

    // Check if voter already voted for any of these positions
    const existingVotes = await prisma.vote.findMany({
      where: {
        ballotId: ballot.id,
        positionId: {
          in: positionIds,
        },
      },
    });

    if (existingVotes.length > 0) {
      return res.status(400).json({ error: 'You have already voted for some of these positions' });
    }

    // Create vote records (transaction)
    const voteRecords = await prisma.$transaction(
      votes.map((vote) =>
        prisma.vote.create({
          data: {
            ballotId: ballot.id,
            positionId: vote.positionId,
            candidateId: vote.candidateId,
          },
        })
      )
    );

    // Mark ballot as consumed
    await prisma.ballot.update({
      where: { id: ballot.id },
      data: {
        status: 'CONSUMED',
        consumedAt: new Date(),
      },
    });

    // Log audit (non-blocking - don't wait for it)
    logAudit({
      actorType: 'voter',
      actorId: ballot.voter.id,
      action: 'CAST_VOTE',
      entity: 'ballot',
      entityId: ballot.id,
      payload: {
        regNo: ballot.voter.regNo,
        positionsVoted: votes.length,
        positions: votes.map((v) => ({
          positionId: v.positionId,
          candidateId: v.candidateId,
        })),
      },
    }).catch(err => console.error('Audit log error (non-critical):', err));

    res.json({
      message: 'Vote cast successfully',
      votes: voteRecords.length,
      note: 'Your vote has been recorded. Thank you for participating!',
    });
  } catch (error) {
    console.error('Cast vote error:', error);
    res.status(500).json({ error: 'Failed to cast vote' });
  }
};


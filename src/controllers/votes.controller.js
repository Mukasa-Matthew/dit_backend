const { prisma } = require('../config/prisma');
const { logAudit } = require('../utils/auditLogger');

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
    const now = new Date();
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
    const now = new Date();
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


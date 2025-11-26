const { prisma } = require('../config/prisma');
const { logAudit } = require('../utils/auditLogger');

// Helper function to parse dates consistently (same as positions controller)
const parseDate = (dateString) => {
  if (!dateString) return null;
  
  // If date string has timezone info (Z or +/-), use it directly
  if (dateString.includes('Z') || dateString.match(/[+-]\d{2}:\d{2}$/)) {
    return new Date(dateString);
  }
  
  // For datetime-local format (YYYY-MM-DDTHH:mm), parse as local time
  // JavaScript automatically interprets this in the server's local timezone
  // Add seconds if missing
  if (dateString.includes(':') && dateString.split(':').length === 2) {
    return new Date(`${dateString}:00`);
  }
  
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
    // Use current time for comparison (Prisma will handle timezone correctly)
    // Use Date object directly - Prisma handles timezone conversion correctly
    const now = new Date();
    console.log('Backend getBallot - Current time:', {
      local: now.toString(),
      iso: now.toISOString(),
      timestamp: now.getTime(),
    });
    
    // First, get ALL positions to debug
    const allPositions = await prisma.position.findMany({
      orderBy: {
        name: 'asc',
      },
    });
    
    console.log(`Backend getBallot - Total positions in DB: ${allPositions.length}`);
    
    // Debug: Log all positions with their voting windows
    allPositions.forEach((pos, idx) => {
      const voteOpens = new Date(pos.votingOpens);
      const voteCloses = new Date(pos.votingCloses);
      const nowTime = now.getTime();
      const opensTime = voteOpens.getTime();
      const closesTime = voteCloses.getTime();
      const isOpen = nowTime >= opensTime && nowTime <= closesTime;
      
      console.log(`Position ${idx + 1}: ${pos.name}`);
      console.log(`  votingOpens (DB): ${pos.votingOpens} (ISO: ${voteOpens.toISOString()}, timestamp: ${opensTime})`);
      console.log(`  votingCloses (DB): ${pos.votingCloses} (ISO: ${voteCloses.toISOString()}, timestamp: ${closesTime})`);
      console.log(`  Now: ${now.toISOString()} (timestamp: ${nowTime})`);
      console.log(`  Comparison: ${nowTime} >= ${opensTime} && ${nowTime} <= ${closesTime}`);
      console.log(`  Is Open: ${isOpen}`);
    });
    
    // Use Prisma query to filter positions where voting window is currently open
    // This ensures database-level filtering with consistent timezone handling
    const positions = await prisma.position.findMany({
      where: {
        votingOpens: {
          lte: now, // Voting has opened (now >= votingOpens)
        },
        votingCloses: {
          gte: now, // Voting hasn't closed yet (now <= votingCloses)
        },
      },
      orderBy: {
        name: 'asc',
      },
    });
    
    console.log(`Backend getBallot - found ${positions.length} open positions for voting (via Prisma query)`);
    if (positions.length > 0) {
      console.log('Open positions:', positions.map(p => ({
        name: p.name,
        votingOpens: new Date(p.votingOpens).toISOString(),
        votingCloses: new Date(p.votingCloses).toISOString(),
      })));
    } else if (allPositions.length > 0) {
      console.warn('⚠️ Positions exist but none are open for voting!');
      console.warn('Check the voting window times vs current time');
      console.warn('This might be a timezone issue - check server logs above for date comparisons');
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
    // Use Date object directly - Prisma handles timezone conversion correctly
    // This must match the logic in getBallot for consistency
    const now = new Date();
    console.log('Backend castVote - Current time:', {
      local: now.toString(),
      iso: now.toISOString(),
      timestamp: now.getTime(),
    });
    
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

    console.log(`Backend castVote - found ${positions.length} open positions out of ${votes.length} requested`);
    
    if (positions.length !== votes.length) {
      // Get position names that are not open
      const allPositions = await prisma.position.findMany({
        where: {
          id: { in: votes.map((v) => v.positionId) },
        },
        select: { id: true, name: true, votingOpens: true, votingCloses: true },
      });
      
      // Use the same now value for consistency
      const closedPositions = allPositions.filter((p) => {
        const voteOpens = new Date(p.votingOpens);
        const voteCloses = new Date(p.votingCloses);
        const isOpen = now >= voteOpens && now <= voteCloses;
        if (!isOpen) {
          console.log(`Position ${p.name} is closed:`, {
            votingOpens: voteOpens.toISOString(),
            votingCloses: voteCloses.toISOString(),
            now: now.toISOString(),
            opensTime: voteOpens.getTime(),
            closesTime: voteCloses.getTime(),
            nowTime: now.getTime(),
          });
        }
        return !isOpen;
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


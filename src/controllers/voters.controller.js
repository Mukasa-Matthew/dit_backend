const { prisma } = require('../config/prisma');
const { logAudit } = require('../utils/auditLogger');
const csv = require('csv-parser');
const fs = require('fs');
const { Readable } = require('stream');

// Import voters from CSV
exports.importCSV = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'CSV file is required' });
    }

    const results = [];
    const errors = [];
    let rowNumber = 0;

    // Parse CSV file
    const stream = Readable.from(req.file.buffer.toString());
    
    await new Promise((resolve, reject) => {
      stream
        .pipe(csv())
        .on('data', async (row) => {
          rowNumber++;
          try {
            // Validate required fields
            if (!row.reg_no || !row.name || !row.email || !row.phone) {
              errors.push(`Row ${rowNumber}: Missing required fields (reg_no, name, email, phone)`);
              return;
            }

            // Normalize registration number
            const regNo = row.reg_no.trim().toUpperCase();

            // Check if voter already exists
            const existing = await prisma.eligibleVoter.findUnique({
              where: { regNo },
            });

            if (existing) {
              // Update existing voter
              await prisma.eligibleVoter.update({
                where: { regNo },
                data: {
                  name: row.name.trim(),
                  email: row.email.trim(),
                  phone: row.phone.trim(),
                  program: row.program?.trim() || null,
                  status: 'ELIGIBLE',
                },
              });
              results.push({ regNo, action: 'updated' });
            } else {
              // Create new voter
              await prisma.eligibleVoter.create({
                data: {
                  regNo,
                  name: row.name.trim(),
                  email: row.email.trim(),
                  phone: row.phone.trim(),
                  program: row.program?.trim() || null,
                  status: 'ELIGIBLE',
                },
              });
              results.push({ regNo, action: 'created' });
            }
          } catch (error) {
            errors.push(`Row ${rowNumber}: ${error.message}`);
          }
        })
        .on('end', resolve)
        .on('error', reject);
    });

    // Get actual count from database to verify
    const actualCount = await prisma.eligibleVoter.count();

    // Log audit
    await logAudit({
      actorType: 'admin',
      actorId: req.user.id,
      action: 'IMPORT_VOTERS',
      entity: 'eligible_voter',
      payload: {
        totalRows: rowNumber,
        successful: results.length,
        errors: errors.length,
        actualCountInDatabase: actualCount,
      },
    });

    res.json({
      message: 'Voters imported successfully',
      summary: {
        total: rowNumber,
        successful: results.length,
        errors: errors.length,
        created: results.filter((r) => r.action === 'created').length,
        updated: results.filter((r) => r.action === 'updated').length,
        actualCountInDatabase: actualCount, // Show actual count in database
      },
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error) {
    console.error('Import voters error:', error);
    res.status(500).json({ error: 'Failed to import voters' });
  }
};

// Get all eligible voters
exports.getAllVoters = async (req, res) => {
  try {
    const { page = 1, limit = 100, search } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const where = {};
    if (search && typeof search === 'string' && search.trim().length > 0) {
      const searchTerm = search.trim();
      // For MySQL, try without mode first (MySQL is usually case-insensitive by default)
      // If that doesn't work, we'll use raw SQL
      where.OR = [
        { regNo: { contains: searchTerm } },
        { name: { contains: searchTerm } },
        { email: { contains: searchTerm } },
        { phone: { contains: searchTerm } },
      ];
    }

    const [voters, total] = await Promise.all([
      prisma.eligibleVoter.findMany({
        where,
        skip,
        take: parseInt(limit),
        orderBy: {
          createdAt: 'desc',
        },
      }),
      prisma.eligibleVoter.count({ where }),
    ]);

    res.json({
      voters,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        totalPages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    console.error('Get voters error:', error);
    console.error('Error details:', {
      message: error.message,
      stack: error.stack,
      query: req.query,
    });
    res.status(500).json({ 
      error: 'Failed to fetch voters'
      // Error details not exposed in production for security
    });
  }
};

// Delete all voters (Admin only) - for re-importing CSV
// Also deletes all related votes, ballots, verifications, candidates, and positions
// This clears everything for a new voting cycle
exports.deleteAllVoters = async (req, res) => {
  try {
    // Get counts before deletion for audit
    const votersCount = await prisma.eligibleVoter.count();
    const votesCount = await prisma.vote.count();
    const ballotsCount = await prisma.ballot.count();
    const verificationsCount = await prisma.verification.count();
    const candidatesCount = await prisma.candidate.count();
    const positionsCount = await prisma.position.count();

    // Delete in transaction to ensure data consistency
    // Order: Votes -> Ballots -> Verifications -> Candidates -> Positions -> Voters
    const result = await prisma.$transaction(async (tx) => {
      // 1. Delete all votes first (they depend on ballots, positions, and candidates)
      const votesDeleted = await tx.vote.deleteMany({});
      
      // 2. Delete all ballots (they depend on voters)
      const ballotsDeleted = await tx.ballot.deleteMany({});
      
      // 3. Delete all verifications (they depend on voters)
      const verificationsDeleted = await tx.verification.deleteMany({});
      
      // 4. Delete all candidates (they depend on positions and users)
      const candidatesDeleted = await tx.candidate.deleteMany({});
      
      // 5. Delete all positions (candidates already deleted, but positions can be deleted now)
      const positionsDeleted = await tx.position.deleteMany({});
      
      // 6. Delete all voters
      const votersDeleted = await tx.eligibleVoter.deleteMany({});

      return {
        votes: votesDeleted.count,
        ballots: ballotsDeleted.count,
        verifications: verificationsDeleted.count,
        candidates: candidatesDeleted.count,
        positions: positionsDeleted.count,
        voters: votersDeleted.count,
      };
    });

    // Log audit
    await logAudit({
      actorType: 'admin',
      actorId: req.user.id,
      action: 'DELETE_ALL_VOTING_DATA',
      entity: 'eligible_voter',
      payload: {
        votersDeleted: result.voters,
        votesDeleted: result.votes,
        ballotsDeleted: result.ballots,
        verificationsDeleted: result.verifications,
        candidatesDeleted: result.candidates,
        positionsDeleted: result.positions,
        reason: 'Admin cleared all voting data for new voting cycle. CSV file removed.',
      },
    });

    res.json({
      message: 'All voting data deleted successfully. System is ready for a new voting cycle.',
      deletedCount: {
        voters: result.voters,
        votes: result.votes,
        ballots: result.ballots,
        verifications: result.verifications,
        candidates: result.candidates,
        positions: result.positions,
      },
      hint: 'You can now import a new CSV file and create new positions for the next voting cycle.',
    });
  } catch (error) {
    console.error('Delete all voting data error:', error);
    res.status(500).json({ error: 'Failed to delete voting data' });
  }
};


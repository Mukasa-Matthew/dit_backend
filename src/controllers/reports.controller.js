const { prisma } = require('../config/prisma');
const PDFDocument = require('pdfkit');
const { loadCandidatePhoto } = require('../utils/pdfHelpers');
const path = require('path');

// Get audit log
exports.getAuditLog = async (req, res) => {
  try {
    const { page = 1, limit = 50, action, actorType } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const where = {};
    if (action) {
      where.action = { contains: action, mode: 'insensitive' };
    }
    if (actorType) {
      where.actorType = actorType;
    }

    const [logs, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        skip,
        take: parseInt(limit),
        orderBy: {
          createdAt: 'desc',
        },
      }),
      prisma.auditLog.count({ where }),
    ]);

    res.json({
      logs,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        totalPages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    console.error('Get audit log error:', error);
    res.status(500).json({ error: 'Failed to fetch audit log' });
  }
};

// Get turnout report with detailed breakdown
exports.getTurnout = async (req, res) => {
  try {
    const totalVoters = await prisma.eligibleVoter.count({
      where: { status: 'ELIGIBLE' },
    });

    const verifiedVoters = await prisma.verification.count({
      where: { verifiedAt: { not: null } },
    });

    const votesCast = await prisma.ballot.count({
      where: { status: 'CONSUMED' },
    });

    const ballotsIssued = await prisma.ballot.count();

    const turnout = totalVoters > 0 ? (votesCast / totalVoters) * 100 : 0;
    const verificationRate =
      totalVoters > 0 ? (verifiedVoters / totalVoters) * 100 : 0;
    const ballotUsageRate =
      ballotsIssued > 0 ? (votesCast / ballotsIssued) * 100 : 0;
    const nonVoters = totalVoters - votesCast;
    const nonVoterPercentage =
      totalVoters > 0 ? (nonVoters / totalVoters) * 100 : 0;

    res.json({
      totalVoters,
      verifiedVoters,
      votesCast,
      ballotsIssued,
      nonVoters,
      turnout: parseFloat(turnout.toFixed(2)),
      verificationRate: parseFloat(verificationRate.toFixed(2)),
      ballotUsageRate: parseFloat(ballotUsageRate.toFixed(2)),
      nonVoterPercentage: parseFloat(nonVoterPercentage.toFixed(2)),
      breakdown: {
        voted: votesCast,
        notVoted: nonVoters,
        verified: verifiedVoters,
        notVerified: totalVoters - verifiedVoters,
      },
    });
  } catch (error) {
    console.error('Get turnout error:', error);
    res.status(500).json({ error: 'Failed to fetch turnout report' });
  }
};

// Get results report with detailed analytics
exports.getResults = async (req, res) => {
  try {
    const positions = await prisma.position.findMany({
      include: {
        candidates: {
          include: {
            user: {
              select: {
                name: true,
                email: true,
              },
            },
            _count: {
              select: {
                votes: true,
              },
            },
          },
          where: {
            status: 'APPROVED',
          },
        },
      },
      orderBy: { name: 'asc' },
    });

    // Get total votes cast for all positions
    const totalVotesCast = await prisma.ballot.count({
      where: { status: 'CONSUMED' },
    });

    const results = positions.map((position) => {
      // Calculate total votes for this position
      const positionTotalVotes = position.candidates.reduce(
        (sum, candidate) => sum + candidate._count.votes,
        0
      );

      // Sort candidates by votes (descending)
      const sortedCandidates = [...position.candidates].sort(
        (a, b) => b._count.votes - a._count.votes
      );

      // Calculate percentages and rankings
      const candidatesWithStats = sortedCandidates.map((candidate, index) => {
        const votePercentage =
          positionTotalVotes > 0
            ? ((candidate._count.votes / positionTotalVotes) * 100).toFixed(2)
            : '0.00';
        const overallPercentage =
          totalVotesCast > 0
            ? ((candidate._count.votes / totalVotesCast) * 100).toFixed(2)
            : '0.00';

        return {
          candidateId: candidate.id,
          name: candidate.name,
          program: candidate.program,
          votes: candidate._count.votes,
          rank: index + 1,
          votePercentage: parseFloat(votePercentage),
          overallPercentage: parseFloat(overallPercentage),
          isWinner: index < position.seats,
        };
      });

      return {
        positionId: position.id,
        positionName: position.name,
        seats: position.seats,
        totalVotes: positionTotalVotes,
        candidates: candidatesWithStats,
        winner: candidatesWithStats[0] || null,
      };
    });

    res.json({
      positions: results,
      summary: {
        totalPositions: positions.length,
        totalCandidates: positions.reduce(
          (sum, p) => sum + p.candidates.length,
          0
        ),
        totalVotesCast,
      },
    });
  } catch (error) {
    console.error('Get results error:', error);
    res.status(500).json({ error: 'Failed to fetch results report' });
  }
};

// Export report (CSV/PDF generation)
exports.exportReport = async (req, res) => {
  try {
    const { type } = req.params; // e.g., 'turnout-csv', 'results-pdf', 'audit-csv'

    if (type.startsWith('turnout')) {
      const totalVoters = await prisma.eligibleVoter.count({ where: { status: 'ELIGIBLE' } });
      const votesCast = await prisma.ballot.count({ where: { status: 'CONSUMED' } });
      const turnoutPercent = totalVoters > 0 ? ((votesCast / totalVoters) * 100).toFixed(2) : '0.00';
      
      if (type.endsWith('csv')) {
        const csv = `Total Voters,Votes Cast,Turnout %\n${totalVoters},${votesCast},${turnoutPercent}%`;
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename=turnout-report.csv');
        return res.send(csv);
      } else if (type.endsWith('pdf')) {
        // Generate PDF
        const doc = new PDFDocument({ margin: 50 });
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', 'attachment; filename=turnout-report.pdf');
        doc.pipe(res);

        // Header
        doc.fontSize(20).text('Election Turnout Report', { align: 'center' });
        doc.moveDown();
        doc.fontSize(12).text(`Generated: ${new Date().toLocaleString()}`, { align: 'center' });
        doc.moveDown(2);

        // Report data
        doc.fontSize(16).text('Summary', { underline: true });
        doc.moveDown();
        doc.fontSize(12);
        doc.text(`Total Eligible Voters: ${totalVoters}`, { indent: 20 });
        doc.text(`Votes Cast: ${votesCast}`, { indent: 20 });
        doc.text(`Turnout Percentage: ${turnoutPercent}%`, { indent: 20 });
        doc.moveDown();
        doc.fontSize(10).text('E-Voting System - Professional Election Management Platform', { align: 'center' });

        doc.end();
        return;
      }
      res.json({ totalVoters, votesCast, turnout: parseFloat(turnoutPercent) });
    } else if (type.startsWith('results')) {
      // Get results data
      const positions = await prisma.position.findMany({
        include: {
          candidates: {
            include: {
              user: {
                select: { name: true, email: true },
              },
              _count: {
                select: { votes: true },
              },
            },
            where: { status: 'APPROVED' },
          },
        },
        orderBy: { name: 'asc' },
      });

      if (type.endsWith('csv')) {
        let csv = 'Position,Candidate Name,Program,Votes\n';
        positions.forEach((position) => {
          position.candidates.forEach((candidate) => {
            csv += `"${position.name}","${candidate.name}","${candidate.program}",${candidate._count.votes}\n`;
          });
        });
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename=results-report.csv');
        return res.send(csv);
      } else if (type.endsWith('pdf')) {
        // Generate simple PDF report
        const doc = new PDFDocument({ 
          margin: 50,
          size: 'A4',
        });
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', 'attachment; filename=results-report.pdf');
        doc.pipe(res);

        // Simple Header
        doc.fillColor('#000000')
          .fontSize(24)
          .font('Helvetica-Bold')
          .text('Election Results Report', 50, 50, { align: 'center', width: doc.page.width - 100 });
        
        doc.fontSize(10)
          .font('Helvetica')
          .fillColor('#000000')
          .text(`Generated: ${new Date().toLocaleString()}`, 50, 80, { align: 'center', width: doc.page.width - 100 });
        
        doc.y = 110;

        // Process each position
        for (let index = 0; index < positions.length; index++) {
          const position = positions[index];
          
          if (index > 0) {
            doc.addPage();
            doc.y = 50;
          }

          // Simple Position Header
          doc.fillColor('#000000')
            .fontSize(18)
            .font('Helvetica-Bold')
            .text(position.name.toUpperCase(), 50, doc.y);
          
          doc.fontSize(10)
            .font('Helvetica')
            .fillColor('#000000')
            .text(`Seats Available: ${position.seats}`, 50, doc.y + 5);
          
          doc.y += 30;

          if (position.candidates.length === 0) {
            doc.fillColor('#000000')
              .fontSize(12)
              .font('Helvetica')
              .text('No candidates for this position.', 50, doc.y);
            doc.y += 30;
          } else {
            // Sort candidates by votes
            const sortedCandidates = [...position.candidates].sort((a, b) => b._count.votes - a._count.votes);
            const totalVotes = sortedCandidates.reduce((sum, c) => sum + c._count.votes, 0);

            // Candidate details section
            let currentY = doc.y;

            // Process candidates sequentially to handle async photo loading
            for (let idx = 0; idx < sortedCandidates.length; idx++) {
              const candidate = sortedCandidates[idx];
              
              // Check if we need a new page
              if (currentY > doc.page.height - 150) {
                doc.addPage();
                currentY = 50;
              }

              const isWinner = idx < position.seats;
              const votePercentage = totalVotes > 0 
                ? ((candidate._count.votes / totalVotes) * 100).toFixed(2) 
                : '0.00';

              // Simple candidate entry
              const photoX = 50;
              const photoY = currentY;
              const photoSize = 60;

              // Candidate photo
              try {
                const photoBuffer = await loadCandidatePhoto(candidate.photoUrl, candidate.name);
                if (photoBuffer) {
                  doc.image(photoBuffer, photoX, photoY, { 
                    width: photoSize, 
                    height: photoSize,
                    fit: [photoSize, photoSize],
                  });
                }
              } catch (photoError) {
                console.warn(`Photo error for ${candidate.name}:`, photoError.message);
              }

              // Candidate information (right side of photo)
              const infoX = photoX + photoSize + 15;
              const infoY = currentY;

              // Rank
              doc.fillColor('#000000')
                .fontSize(12)
                .font('Helvetica-Bold')
                .text(`Rank: ${idx + 1}`, infoX, infoY);

              // Candidate name
              doc.fillColor('#000000')
                .fontSize(14)
                .font('Helvetica-Bold')
                .text(candidate.name, infoX, infoY + 18);

              // Program
              if (candidate.program) {
                doc.fillColor('#000000')
                  .fontSize(10)
                  .font('Helvetica')
                  .text(candidate.program, infoX, infoY + 35);
              }

              // Votes and percentage
              doc.fillColor('#000000')
                .fontSize(12)
                .font('Helvetica')
                .text(`Votes: ${candidate._count.votes}`, infoX, infoY + 48);

              doc.fillColor('#000000')
                .fontSize(12)
                .font('Helvetica')
                .text(`Percentage: ${votePercentage}%`, infoX, infoY + 62);

              // Winner declaration
              if (isWinner) {
                doc.fillColor('#000000')
                  .fontSize(12)
                  .font('Helvetica-Bold')
                  .text('WINNER', infoX, infoY + 78);
              }

              currentY += photoSize + 30;
            }
            
            doc.y = currentY;
            doc.moveDown(1);

            // Simple Summary
            doc.fillColor('#000000')
              .fontSize(12)
              .font('Helvetica-Bold')
              .text('Summary:', 50, doc.y);
            
            doc.y += 20;
            doc.fillColor('#000000')
              .fontSize(10)
              .font('Helvetica')
              .text(`Total Candidates: ${sortedCandidates.length}`, 50, doc.y);
            
            doc.y += 15;
            doc.fillColor('#000000')
              .fontSize(10)
              .font('Helvetica')
              .text(`Total Votes Cast: ${totalVotes}`, 50, doc.y);
            
            doc.y += 15;
            doc.fillColor('#000000')
              .fontSize(10)
              .font('Helvetica')
              .text(`Seats Available: ${position.seats}`, 50, doc.y);

            doc.y += 30;
          }
        }

        // Simple Footer
        const footerY = doc.page.height - 30;
        doc.fillColor('#000000')
          .fontSize(8)
          .font('Helvetica')
          .text(`Generated on ${new Date().toLocaleString()}`, 50, footerY, { 
            align: 'center', 
            width: doc.page.width - 100 
          });

        doc.end();
        return;
      }
      res.json(positions.map((p) => ({
        positionName: p.name,
        candidates: p.candidates.map((c) => ({
          name: c.name,
          votes: c._count.votes,
        })),
      })));
    } else if (type.startsWith('audit')) {
      const logs = await prisma.auditLog.findMany({
        take: 1000,
        orderBy: { createdAt: 'desc' },
      });

      if (type.endsWith('csv')) {
        let csv = 'Date,Actor Type,Action,Entity,Details\n';
        logs.forEach((log) => {
          const details = log.payload ? JSON.stringify(log.payload) : '';
          csv += `"${log.createdAt}","${log.actorType}","${log.action}","${log.entity || ''}","${details}"\n`;
        });
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename=audit-log.csv');
        return res.send(csv);
      }
      res.json({ logs });
    } else {
      res.status(400).json({ error: 'Invalid export type' });
    }
  } catch (error) {
    console.error('Export report error:', error);
    res.status(500).json({ error: 'Failed to export report' });
  }
};


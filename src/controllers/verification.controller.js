const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { prisma } = require('../config/prisma');
const { logAudit } = require('../utils/auditLogger');
const { sendOTPEmail } = require('../utils/emailService');
const { sendOTPSMS } = require('../utils/smsService');

/**
 * Request OTP for voter verification
 * 
 * Flow:
 * 1. Voter enters registration number
 * 2. System finds eligible voter
 * 3. Generates OTP
 * 4. Sends OTP via email (NodeMailer)
 * 5. Stores hashed OTP in database
 * 6. Returns success
 */
exports.requestOTP = async (req, res) => {
  try {
    const { reg_no } = req.body;

    if (!reg_no) {
      return res.status(400).json({ error: 'Registration number is required' });
    }

    // Find eligible voter
    const voter = await prisma.eligibleVoter.findUnique({
      where: { regNo: reg_no.toUpperCase() },
    });

    if (!voter) {
      return res.status(404).json({ error: 'Registration number not found' });
    }

    if (voter.status !== 'ELIGIBLE') {
      return res.status(400).json({ error: 'Voter is not eligible' });
    }

    // Check if voter has already voted (prevent repeat verification)
    const existingBallot = await prisma.ballot.findFirst({
      where: {
        voterId: voter.id,
        status: 'CONSUMED',
      },
    });

    if (existingBallot) {
      return res.status(400).json({ 
        error: 'You have already voted. Ballot already used.',
        hint: 'Each voter can only vote once',
      });
    }

    // Check for recent OTP request (rate limiting)
    const recentVerification = await prisma.verification.findFirst({
      where: {
        voterId: voter.id,
        issuedAt: {
          gte: new Date(Date.now() - 2 * 60 * 1000), // Last 2 minutes
        },
        verifiedAt: null, // Not yet verified
      },
      orderBy: {
        issuedAt: 'desc',
      },
    });

    if (recentVerification) {
      return res.status(429).json({ 
        error: 'Please wait before requesting another OTP',
        retryAfter: 120, // seconds
      });
    }

    // Generate 6-digit OTP
    const otp = crypto.randomInt(100000, 999999).toString();
    const otpHash = await bcrypt.hash(otp, 10);

    // Set expiration (5 minutes for security)
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

    // Validate that voter has both email and phone
    if (!voter.email) {
      return res.status(400).json({ 
        error: 'Voter email not found',
        hint: 'Contact administrator to update your email address in the CSV file',
      });
    }

    if (!voter.phone) {
      return res.status(400).json({ 
        error: 'Voter phone number not found',
        hint: 'Contact administrator to update your phone number in the CSV file',
      });
    }

    // Create verification record
    const verification = await prisma.verification.create({
      data: {
        voterId: voter.id,
        method: 'both', // Both email and SMS
        otpHash,
        expiresAt,
      },
    });

    // Track which methods succeeded
    const sentMethods = [];
    const failedMethods = [];

    // Send OTP via email (non-blocking - don't await, let it run in background)
    sendOTPEmail(voter.email, otp, voter.regNo)
      .then(() => {
        sentMethods.push('email');
        console.log('✅ OTP email sent successfully');
      })
      .catch((emailError) => {
        console.error('Failed to send OTP email:', emailError);
        failedMethods.push('email');
        
        // Log email error (non-blocking)
        logAudit({
          actorType: 'system',
          action: 'OTP_EMAIL_FAILED',
          entity: 'verification',
          entityId: verification.id,
          payload: { 
            voterId: voter.id, 
            error: emailError.message,
            regNo: voter.regNo,
          },
        }).catch(err => console.error('Failed to log email error:', err));
      });

    // Send OTP via SMS (non-blocking - don't await, let it run in background)
    sendOTPSMS(voter.phone, otp, voter.regNo)
      .then(() => {
        sentMethods.push('SMS');
        console.log('✅ OTP SMS sent successfully');
      })
      .catch((smsError) => {
        console.error('Failed to send OTP SMS:', smsError);
        failedMethods.push('SMS');
        
        // Log SMS error (non-blocking)
        logAudit({
          actorType: 'system',
          action: 'OTP_SMS_FAILED',
          entity: 'verification',
          entityId: verification.id,
          payload: { 
            voterId: voter.id, 
            error: smsError.message,
            regNo: voter.regNo,
          },
        }).catch(err => console.error('Failed to log SMS error:', err));
      });

    // If both methods failed, return error
    if (sentMethods.length === 0) {
      return res.status(500).json({ 
        error: 'Failed to send OTP via both email and SMS',
        hint: 'Please contact administrator. Both email and SMS services may be misconfigured.',
        details: {
          emailError: failedMethods.includes('email') ? 'Email service failed' : null,
          smsError: failedMethods.includes('SMS') ? 'SMS service failed' : null,
        },
      });
    }

    // Log audit
    await logAudit({
      actorType: 'system',
      action: 'OTP_REQUESTED',
      entity: 'verification',
      entityId: verification.id,
      payload: { 
        voterId: voter.id,
        regNo: voter.regNo,
        methods: sentMethods,
        failedMethods: failedMethods.length > 0 ? failedMethods : undefined,
      },
    });

    // Build response message
    let message = 'OTP sent successfully';
    let hint = '';
    
    if (sentMethods.length === 2) {
      message = 'OTP sent successfully to your email and phone';
      hint = 'Check both your email and SMS for the verification code';
    } else if (sentMethods.includes('email')) {
      message = 'OTP sent successfully to your email';
      hint = 'Check your email for the verification code. SMS delivery failed.';
    } else if (sentMethods.includes('SMS')) {
      message = 'OTP sent successfully to your phone';
      hint = 'Check your SMS for the verification code. Email delivery failed.';
    }

    res.json({
      message,
      expiresIn: 300, // 5 minutes in seconds
      hint,
      sentVia: sentMethods,
      warnings: failedMethods.length > 0 ? {
        message: `Some delivery methods failed: ${failedMethods.join(', ')}`,
        note: 'You can still use the OTP from the method that succeeded'
      } : undefined,
    });
  } catch (error) {
    console.error('Request OTP error:', error);
    res.status(500).json({ error: 'Failed to request OTP' });
  }
};

/**
 * Confirm OTP and issue ballot token
 * 
 * Flow:
 * 1. Voter enters OTP
 * 2. System verifies OTP
 * 3. If valid, generates single-use ballot token
 * 4. Returns ballot token
 * 5. Token can be used once to cast vote
 */
exports.confirmOTP = async (req, res) => {
  try {
    const { reg_no, otp } = req.body;

    if (!reg_no || !otp) {
      return res.status(400).json({ error: 'Registration number and OTP are required' });
    }

    // Find eligible voter
    const voter = await prisma.eligibleVoter.findUnique({
      where: { regNo: reg_no.toUpperCase() },
    });

    if (!voter) {
      return res.status(404).json({ error: 'Registration number not found' });
    }

    // Find unverified OTP
    const verification = await prisma.verification.findFirst({
      where: {
        voterId: voter.id,
        verifiedAt: null,
        consumedAt: null,
        expiresAt: {
          gte: new Date(), // Not expired
        },
      },
      orderBy: {
        issuedAt: 'desc',
      },
    });

    if (!verification) {
      return res.status(400).json({ 
        error: 'No valid OTP found',
        hint: 'Request a new OTP',
      });
    }

    // Verify OTP
    const validOTP = await bcrypt.compare(otp, verification.otpHash);
    if (!validOTP) {
      // Log failed attempt
      await logAudit({
        actorType: 'system',
        action: 'OTP_VERIFICATION_FAILED',
        entity: 'verification',
        entityId: verification.id,
        payload: { voterId: voter.id, regNo: voter.regNo },
      });

      return res.status(401).json({ error: 'Invalid OTP' });
    }

    // Check if voter has already voted
    const existingBallot = await prisma.ballot.findFirst({
      where: {
        voterId: voter.id,
        status: 'CONSUMED',
      },
    });

    if (existingBallot) {
      return res.status(400).json({ 
        error: 'You have already voted. Ballot already used.',
      });
    }

    // Mark OTP as verified
    await prisma.verification.update({
      where: { id: verification.id },
      data: {
        verifiedAt: new Date(),
      },
    });

    // Generate single-use ballot token
    const ballotToken = crypto.randomBytes(32).toString('hex');

    // Create ballot
    const ballot = await prisma.ballot.create({
      data: {
        voterId: voter.id,
        token: ballotToken,
        status: 'ACTIVE',
      },
    });

    // Link verification to ballot
    await prisma.verification.update({
      where: { id: verification.id },
      data: {
        ballotToken: ballotToken,
      },
    });

    // Log audit
    await logAudit({
      actorType: 'system',
      action: 'OTP_VERIFIED_BALLOT_ISSUED',
      entity: 'ballot',
      entityId: ballot.id,
      payload: { 
        voterId: voter.id,
        regNo: voter.regNo,
        ballotToken: ballotToken.substring(0, 8) + '...', // Partial token for logging
      },
    });

    res.json({
      message: 'Verification successful',
      ballotToken,
      expiresAt: ballot.issuedAt,
      note: 'Use this token to cast your vote. It can only be used once.',
    });
  } catch (error) {
    console.error('Confirm OTP error:', error);
    res.status(500).json({ error: 'Failed to verify OTP' });
  }
};



const nodemailer = require('nodemailer');
require('dotenv').config();

/**
 * Email Service using NodeMailer
 * 
 * Configuration from .env:
 * - EMAIL_HOST: SMTP host (e.g., smtp.gmail.com)
 * - EMAIL_PORT: SMTP port (e.g., 587)
 * - EMAIL_USER: Your email address
 * - EMAIL_APP_PASSWORD: Your app password (not regular password)
 * - EMAIL_FROM: From address (defaults to EMAIL_USER)
 */

// Create transporter
const createTransporter = () => {
  const emailUser = process.env.EMAIL_USER?.trim();
  const emailPassword = process.env.EMAIL_APP_PASSWORD?.trim();

  // Validate configuration
  if (!emailUser || !emailPassword) {
    console.warn('⚠️  Email configuration incomplete. EMAIL_USER and EMAIL_APP_PASSWORD must be set in .env');
    return null;
  }

  // Remove spaces from app password (Gmail shows it with spaces, but we need without)
  const cleanPassword = emailPassword.replace(/\s/g, '');

  const config = {
    host: process.env.EMAIL_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.EMAIL_PORT || '587'),
    secure: false, // true for 465, false for other ports
    auth: {
      user: emailUser,
      pass: cleanPassword, // App password, not regular password
    },
  };

  return nodemailer.createTransport(config);
};

const transporter = createTransporter();

/**
 * Send OTP email to voter
 */
exports.sendOTPEmail = async (email, otp, regNo) => {
  if (!transporter) {
    throw new Error('Email service not configured. Please set EMAIL_USER and EMAIL_APP_PASSWORD in .env');
  }

  const mailOptions = {
    from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
    to: email,
    subject: 'E-Voting System - Verification OTP',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #2563eb;">E-Voting System Verification</h2>
        <p>Hello,</p>
        <p>You have requested to verify your identity for the E-Voting System.</p>
        <div style="background-color: #f3f4f6; padding: 20px; border-radius: 8px; margin: 20px 0;">
          <p style="margin: 0; font-size: 14px; color: #6b7280;">Registration Number:</p>
          <p style="margin: 5px 0 0 0; font-size: 18px; font-weight: bold; color: #111827;">${regNo}</p>
        </div>
        <div style="background-color: #dbeafe; padding: 20px; border-radius: 8px; margin: 20px 0; text-align: center;">
          <p style="margin: 0; font-size: 14px; color: #1e40af;">Your Verification Code:</p>
          <p style="margin: 10px 0 0 0; font-size: 32px; font-weight: bold; color: #1e40af; letter-spacing: 4px;">${otp}</p>
        </div>
                <p style="color: #6b7280; font-size: 14px;">
                  <strong>Important:</strong>
                  <ul style="color: #6b7280; font-size: 14px;">
                    <li>This code expires in 5 minutes</li>
                    <li>Do not share this code with anyone</li>
                    <li>If you did not request this code, please ignore this email</li>
                  </ul>
                </p>
        <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 30px 0;">
        <p style="color: #9ca3af; font-size: 12px; text-align: center;">
          This is an automated message from the E-Voting System.<br>
          Please do not reply to this email.
        </p>
      </div>
    `,
    text: `
E-Voting System Verification

You have requested to verify your identity for the E-Voting System.

Registration Number: ${regNo}

Your Verification Code: ${otp}

        Important:
        - This code expires in 5 minutes
        - Do not share this code with anyone
        - If you did not request this code, please ignore this email

This is an automated message from the E-Voting System.
    `,
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log('✅ OTP email sent:', info.messageId);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error('❌ Failed to send OTP email:', error);
    
    // Provide helpful error messages
    if (error.code === 'EAUTH') {
      const helpfulError = new Error(
        'Gmail authentication failed. Please check:\n' +
        '1. EMAIL_USER in .env matches your Gmail address\n' +
        '2. EMAIL_APP_PASSWORD is a valid Gmail App Password (not regular password)\n' +
        '3. 2-Step Verification is enabled on your Google account\n' +
        '4. App Password was generated correctly (16 characters, no spaces)\n' +
        '\nOriginal error: ' + error.message
      );
      helpfulError.code = 'EAUTH';
      helpfulError.originalError = error;
      throw helpfulError;
    }
    
    throw error;
  }
};

/**
 * Send notification email (e.g., nomination approved/rejected)
 */
exports.sendNotificationEmail = async (email, subject, message) => {
  if (!transporter) {
    console.warn('Email service not configured. Skipping notification email.');
    return { success: false, error: 'Email service not configured' };
  }

  const mailOptions = {
    from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
    to: email,
    subject: subject,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #2563eb;">E-Voting System</h2>
        <div style="background-color: #f9fafb; padding: 20px; border-radius: 8px; margin: 20px 0;">
          ${message}
        </div>
        <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 30px 0;">
        <p style="color: #9ca3af; font-size: 12px; text-align: center;">
          This is an automated message from the E-Voting System.
        </p>
      </div>
    `,
    text: message,
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error('Failed to send notification email:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Send password reset OTP email
 */
exports.sendPasswordResetOTP = async (email, otp, userName) => {
  if (!transporter) {
    throw new Error('Email service not configured. Please set EMAIL_USER and EMAIL_APP_PASSWORD in .env');
  }

  const mailOptions = {
    from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
    to: email,
    subject: 'E-Voting System - Password Reset OTP',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #2563eb;">Password Reset Request</h2>
        <p>Hello ${userName || 'there'},</p>
        <p>You have requested to reset your password for your E-Voting System account.</p>
        <div style="background-color: #dbeafe; padding: 20px; border-radius: 8px; margin: 20px 0; text-align: center;">
          <p style="margin: 0; font-size: 14px; color: #1e40af;">Your Password Reset Code:</p>
          <p style="margin: 10px 0 0 0; font-size: 32px; font-weight: bold; color: #1e40af; letter-spacing: 4px;">${otp}</p>
        </div>
        <p style="color: #6b7280; font-size: 14px;">
          <strong>Important:</strong>
          <ul style="color: #6b7280; font-size: 14px;">
            <li>This code expires in 5 minutes</li>
            <li>Do not share this code with anyone</li>
            <li>If you did not request a password reset, please ignore this email</li>
            <li>Your account remains secure if you did not request this</li>
          </ul>
        </p>
        <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 30px 0;">
        <p style="color: #9ca3af; font-size: 12px; text-align: center;">
          This is an automated message from the E-Voting System.<br>
          Please do not reply to this email.
        </p>
      </div>
    `,
    text: `
Password Reset Request

Hello ${userName || 'there'},

You have requested to reset your password for your E-Voting System account.

Your Password Reset Code: ${otp}

Important:
- This code expires in 5 minutes
- Do not share this code with anyone
- If you did not request a password reset, please ignore this email
- Your account remains secure if you did not request this

This is an automated message from the E-Voting System.
    `,
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log('✅ Password reset OTP email sent:', info.messageId);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error('❌ Failed to send password reset OTP email:', error);
    
    if (error.code === 'EAUTH') {
      const helpfulError = new Error(
        'Gmail authentication failed. Please check:\n' +
        '1. EMAIL_USER in .env matches your Gmail address\n' +
        '2. EMAIL_APP_PASSWORD is a valid Gmail App Password (not regular password)\n' +
        '3. 2-Step Verification is enabled on your Google account\n' +
        '4. App Password was generated correctly (16 characters, no spaces)\n' +
        '\nOriginal error: ' + error.message
      );
      helpfulError.code = 'EAUTH';
      helpfulError.originalError = error;
      throw helpfulError;
    }
    
    throw error;
  }
};

/**
 * Test email configuration
 */
exports.testEmailConfig = async () => {
  if (!transporter) {
    return { 
      success: false, 
      error: 'Email service not configured',
      hint: 'Set EMAIL_USER and EMAIL_APP_PASSWORD in .env file'
    };
  }

  try {
    await transporter.verify();
    return { success: true, message: 'Email configuration is valid' };
  } catch (error) {
    let errorMessage = error.message;
    let hint = '';
    
    if (error.code === 'EAUTH') {
      errorMessage = 'Gmail authentication failed';
      hint = 'Check EMAIL_USER and EMAIL_APP_PASSWORD in .env. Make sure you\'re using a Gmail App Password, not your regular password.';
    } else if (error.code === 'ECONNECTION') {
      errorMessage = 'Cannot connect to email server';
      hint = 'Check EMAIL_HOST and EMAIL_PORT in .env. Verify internet connection.';
    }
    
    return { 
      success: false, 
      error: errorMessage,
      hint: hint || error.message,
      code: error.code
    };
  }
};



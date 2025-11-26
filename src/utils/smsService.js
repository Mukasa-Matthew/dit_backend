const axios = require('axios');
require('dotenv').config();

/**
 * SMS Service using YoolaSMS API (Axios)
 * 
 * Configuration from .env:
 * - SMS_API_URL: YoolaSMS API endpoint URL (default: https://yoolasms.com/api/v1/send)
 * - SMS_API_KEY: Your YoolaSMS API key (required)
 * 
 * This service uses Axios to make HTTP requests to YoolaSMS API
 * API Documentation: https://yoolasms.com/api/v1/send
 */

/**
 * Send OTP via SMS
 * @param {string} phoneNumber - Phone number in international format (e.g., +256701234567)
 * @param {string} otp - 6-digit OTP code
 * @param {string} regNo - Voter registration number
 * @returns {Promise<{success: boolean, messageId?: string, error?: string}>}
 */
exports.sendOTPSMS = async (phoneNumber, otp, regNo) => {
  // Default to YoolaSMS endpoint if not specified
  const smsApiUrl = process.env.SMS_API_URL?.trim() || 'https://yoolasms.com/api/v1/send';
  const smsApiKey = process.env.SMS_API_KEY?.trim();

  // Validate configuration
  if (!smsApiKey) {
    throw new Error(
      'SMS service not configured. Please set SMS_API_KEY in .env file.\n' +
      'Example:\n' +
      'SMS_API_URL=https://yoolasms.com/api/v1/send (optional, this is the default)\n' +
      'SMS_API_KEY=your_yoolasms_api_key_here'
    );
  }

  // Format phone number (ensure it starts with +)
  let formattedPhone = phoneNumber.trim();
  if (!formattedPhone.startsWith('+')) {
    // If phone doesn't start with +, assume it's a local number and add country code
    // Default to Uganda (+256) if no country code provided
    if (formattedPhone.startsWith('0')) {
      formattedPhone = '+256' + formattedPhone.substring(1);
    } else if (!formattedPhone.startsWith('256')) {
      formattedPhone = '+256' + formattedPhone;
    } else {
      formattedPhone = '+' + formattedPhone;
    }
  }

  // Create SMS message
  const message = `Your E-Voting verification code is: ${otp}\nReg No: ${regNo}\nValid for 5 minutes. Do not share this code.`;

  console.log('📱 Sending SMS:', {
    to: formattedPhone,
    apiUrl: smsApiUrl,
    messageLength: message.length,
    timeout: 30000,
  });

  try {
    // YoolaSMS API format
    const requestData = JSON.stringify({
      phone: formattedPhone,
      message: message,
      api_key: smsApiKey,
    });

    const config = {
      method: 'post',
      maxBodyLength: Infinity,
      url: smsApiUrl,
      headers: {
        'Content-Type': 'application/json',
      },
      data: requestData,
      timeout: 30000, // 30 second timeout (increased for slow SMS providers)
    };

    const startTime = Date.now();
    const response = await axios.request(config);
    const duration = Date.now() - startTime;
    console.log(`✅ SMS API responded in ${duration}ms`);

    // Handle YoolaSMS response
    if (response.status === 200 || response.status === 201) {
      const responseData = response.data;
      
      // YoolaSMS typically returns success in response.data
      // Check for common success indicators
      if (responseData.status === 'success' || 
          responseData.success === true || 
          responseData.message_id ||
          (responseData.data && responseData.data.status === 'success')) {
        console.log('✅ OTP SMS sent successfully:', formattedPhone);
        return {
          success: true,
          messageId: responseData.message_id || responseData.id || responseData.data?.message_id || 'N/A',
        };
      } else {
        // Log the actual response for debugging
        console.error('SMS API response:', JSON.stringify(responseData));
        throw new Error(`SMS API returned error: ${JSON.stringify(responseData)}`);
      }
    } else {
      throw new Error(`SMS API returned status ${response.status}`);
    }
  } catch (error) {
    console.error('❌ Failed to send OTP SMS:', error.message);
    console.error('Error details:', {
      code: error.code,
      message: error.message,
      timeout: error.code === 'ECONNABORTED',
    });
    
    // Check if it's a timeout error
    if (error.code === 'ECONNABORTED' || error.message.includes('timeout')) {
      console.error('⏱️ SMS API timeout - provider may be slow or unreachable');
      throw new Error(
        'SMS API request timed out. The SMS provider may be slow or unreachable.\n' +
        'Please check:\n' +
        '1. SMS_API_URL in .env is correct\n' +
        '2. Internet connection is active\n' +
        '3. SMS provider service is available\n' +
        '4. Try again in a few moments'
      );
    }
    
    // Provide helpful error messages
    if (error.response) {
      // Server responded with error status
      const status = error.response.status;
      const data = error.response.data;
      
      if (status === 401 || status === 403) {
        throw new Error(
          'SMS API authentication failed. Please check:\n' +
          '1. SMS_API_KEY in .env is correct\n' +
          '2. API key has proper permissions\n' +
          `\nProvider response: ${JSON.stringify(data)}`
        );
      } else if (status === 400) {
        throw new Error(
          `Invalid SMS request. Please check phone number format.\n` +
          `Provider response: ${JSON.stringify(data)}`
        );
      } else {
        throw new Error(
          `SMS API error (${status}): ${JSON.stringify(data)}`
        );
      }
    } else if (error.request) {
      // Request was made but no response received
      throw new Error(
        'SMS API request failed - no response from server.\n' +
        'Please check:\n' +
        '1. SMS_API_URL in .env is correct\n' +
        '2. Internet connection is active\n' +
        '3. SMS provider service is available'
      );
    } else {
      // Error setting up request
      throw error;
    }
  }
};

/**
 * Send SMS with custom message
 * @param {string} phoneNumber - Phone number in international format
 * @param {string} message - Message to send
 * @returns {Promise<{success: boolean, messageId?: string}>}
 */
exports.sendSMS = async (phoneNumber, message) => {
  // Default to YoolaSMS endpoint if not specified
  const smsApiUrl = process.env.SMS_API_URL?.trim() || 'https://yoolasms.com/api/v1/send';
  const smsApiKey = process.env.SMS_API_KEY?.trim();

  if (!smsApiKey) {
    throw new Error('SMS service not configured. Please set SMS_API_KEY in .env file.');
  }

  let formattedPhone = phoneNumber.trim();
  if (!formattedPhone.startsWith('+')) {
    if (formattedPhone.startsWith('0')) {
      formattedPhone = '+256' + formattedPhone.substring(1);
    } else if (!formattedPhone.startsWith('256')) {
      formattedPhone = '+256' + formattedPhone;
    } else {
      formattedPhone = '+' + formattedPhone;
    }
  }

  try {
    // YoolaSMS API format
    const requestData = JSON.stringify({
      phone: formattedPhone,
      message: message,
      api_key: smsApiKey,
    });

    const config = {
      method: 'post',
      maxBodyLength: Infinity,
      url: smsApiUrl,
      headers: {
        'Content-Type': 'application/json',
      },
      data: requestData,
      timeout: 30000, // 30 second timeout (increased for slow SMS providers)
    };

    const response = await axios.request(config);

    if (response.status === 200 || response.status === 201) {
      const responseData = response.data;
      return {
        success: true,
        messageId: responseData.message_id || responseData.id || responseData.data?.message_id || 'N/A',
      };
    } else {
      throw new Error(`SMS API returned status ${response.status}`);
    }
  } catch (error) {
    console.error('Failed to send SMS:', error.message);
    throw error;
  }
};


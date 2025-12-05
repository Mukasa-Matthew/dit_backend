const express = require('express');
const router = express.Router();
const { testEmailConfig } = require('../utils/emailService');

// Public route to test email configuration
router.get('/test', async (req, res) => {
  try {
    const result = await testEmailConfig();
    res.json(result);
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

module.exports = router;










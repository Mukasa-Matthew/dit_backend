const express = require('express');
const router = express.Router();
const votesController = require('../controllers/votes.controller');

// Public routes - No authentication required (uses ballot token)
router.get('/ballot', votesController.getBallot);
router.post('/', votesController.castVote);

module.exports = router;


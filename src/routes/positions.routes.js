const express = require('express');
const router = express.Router();
const positionsController = require('../controllers/positions.controller');
const { authenticate, authorize } = require('../middleware/auth.middleware');

// Public route - Get open positions (for candidates)
router.get('/open', positionsController.getOpenPositions);

// All other routes require authentication
router.use(authenticate);

// Get all positions
router.get('/', positionsController.getAllPositions);

// Get position by ID
router.get('/:id', positionsController.getPositionById);

// Admin only routes
router.post('/', authorize('ADMIN'), positionsController.createPosition);
router.put('/:id', authorize('ADMIN'), positionsController.updatePosition);
router.patch('/:id/extend', authorize('ADMIN'), positionsController.extendTime);
router.delete('/:id', authorize('ADMIN'), positionsController.deletePosition);

module.exports = router;


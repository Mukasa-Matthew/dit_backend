const express = require('express');
const router = express.Router();
const candidatesController = require('../controllers/candidates.controller');
const { authenticate, authorize } = require('../middleware/auth.middleware');

// Candidate routes
router.post(
  '/',
  authenticate,
  authorize('CANDIDATE'),
  candidatesController.uploadFiles,
  candidatesController.submitNomination
);

router.get('/my', authenticate, authorize('CANDIDATE'), candidatesController.getMyNominations);

// Officer/Admin routes
router.get('/', authenticate, authorize(['OFFICER', 'ADMIN']), candidatesController.getAllNominations);

router.patch('/:id/approve', authenticate, authorize('OFFICER'), candidatesController.approveNomination);

router.patch('/:id/reject', authenticate, authorize('OFFICER'), candidatesController.rejectNomination);

// Admin routes for deleting candidates
router.delete('/:id', authenticate, authorize('ADMIN'), candidatesController.deleteCandidate);

router.delete('/all', authenticate, authorize('ADMIN'), candidatesController.deleteAllCandidates);

module.exports = router;


const express = require('express');
const router = express.Router();
const reportsController = require('../controllers/reports.controller');
const { authenticate, authorize } = require('../middleware/auth.middleware');

// All report routes require admin authentication
router.use(authenticate);
router.use(authorize('ADMIN'));

router.get('/turnout', reportsController.getTurnout);
router.get('/results', reportsController.getResults);
router.get('/audit', reportsController.getAuditLog);
router.get('/export/:type', reportsController.exportReport);

module.exports = router;


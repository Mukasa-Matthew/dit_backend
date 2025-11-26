const express = require('express');
const router = express.Router();
const multer = require('multer');
const votersController = require('../controllers/voters.controller');
const { authenticate, authorize } = require('../middleware/auth.middleware');

// Configure multer for CSV upload
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB max
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'text/csv' || file.originalname.endsWith('.csv')) {
      cb(null, true);
    } else {
      cb(new Error('Only CSV files are allowed'));
    }
  },
});

// All voter routes require admin authentication
router.use(authenticate);
router.use(authorize('ADMIN'));

router.post('/import', upload.single('file'), votersController.importCSV);
router.get('/', votersController.getAllVoters);
router.delete('/all', votersController.deleteAllVoters);

module.exports = router;


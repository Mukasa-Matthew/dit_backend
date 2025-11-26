const express = require('express');
const router = express.Router();
const usersController = require('../controllers/users.controller');
const { authenticate, authorize } = require('../middleware/auth.middleware');

// All routes require authentication and admin role
router.use(authenticate);
router.use(authorize('ADMIN'));

// User management routes
router.get('/', usersController.getAllUsers);
router.get('/:id', usersController.getUserById);
router.post('/', usersController.createUser);
router.put('/:id', usersController.updateUser);
router.delete('/:id', usersController.deleteUser);
router.patch('/:id/activate', usersController.activateUser);
router.patch('/:id/deactivate', usersController.deactivateUser);

module.exports = router;




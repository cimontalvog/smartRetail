const express = require('express');
const router = express.Router();
const controller = require('./controller');

// Show login page by default
router.get('/', controller.showLogin);

// Show login page
router.get('/login', controller.showLogin);

// Login submission
router.post('/login', controller.handleLogin);

// Show register page
router.get('/register', controller.showRegister);

// Register submission
router.post('/register', controller.handleRegister);

// Show dashboard
router.get('/dashboard', controller.showDashboard);

module.exports = router;
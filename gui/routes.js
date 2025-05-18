const express = require('express');
const router = express.Router();
const controller = require('./controller');

// Show login page by default
router.get('/', controller.showLogin);

// Login submission
router.post('/login', controller.handleLogin);

//router.get('/dashboard', controller.showDashboard);

module.exports = router;
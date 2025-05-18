const express = require('express');
const router = express.Router(); // Create an Express router
const controller = require('./controller'); // Import controller functions

// --- Authentication Routes ---

// Default route, shows login page
router.get('/', controller.showLogin);

// Show login page with optional messages/errors from session
router.get('/login', (req, res) => {
    const message = req.session.message; // Get success message
    delete req.session.message; // Clear message from session
    const error = req.session.error; // Get error message
    delete req.session.error; // Clear error from session
    res.render('login', { message, error }); // Render login with messages/errors
});

// Handle login form submission
router.post('/login', controller.handleLogin);

// Handle user logout
router.post('/logout', (req, res) => {
    req.session.destroy(err => { // Destroy the user's session
        if (err) {
            console.error("Failed to destroy session during logout", err);
            return res.redirect('/dashboard'); // Redirect to dashboard on error
        }
        res.clearCookie('connect.sid'); // Clear the session cookie
        res.redirect('/login'); // Redirect to login page
    });
});

// Show registration page with optional errors
router.get('/register', (req, res) => {
    const error = req.session.error; // Get error message
    delete req.session.error; // Clear error from session
    res.render('register', { error }); // Render register with error
});

// Handle registration form submission
router.post('/register', controller.handleRegister);

// --- Application Routes ---

// Show dashboard page
router.get('/dashboard', controller.showDashboard);

// Handle post request to show checkout page
router.post('/checkout', controller.showCheckout);

// Handle post request to confirm purchase
router.post('/confirmPurchase', controller.confirmPurchase);

module.exports = router; // Export the configured router
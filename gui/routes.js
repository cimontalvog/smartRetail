const express = require('express');
const router = express.Router();
const controller = require('./controller');

// Show login page by default
router.get('/', controller.showLogin);

// Show login page
router.get('/login', (req, res) => {
    const message = req.session.message;
	delete req.session.message;
	const error = req.session.error;
	delete req.session.error;
	res.render('login', { message, error });
});

// Login submission
router.post('/login', controller.handleLogin);

// Logout
router.post('/logout', (req, res) => {
	req.session.destroy(err => {
		if (err) {
			console.error("Failed to destroy session during logout", err);
			return res.redirect('/dashboard');
		}
		res.clearCookie('connect.sid'); // This clears the session cookie
		res.redirect('/login');
	});
});

// Show register page
router.get('/register', (req, res) => {
	const error = req.session.error;
	delete req.session.error;
	res.render('register', { error });
});

// Register submission
router.post('/register', controller.handleRegister);

// Show dashboard
router.get('/dashboard', controller.showDashboard);

router.post('/checkout', controller.showCheckout);

router.post('/confirmPurchase', controller.confirmPurchase);

module.exports = router;
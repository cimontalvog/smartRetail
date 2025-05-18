const path = require('path');
const bcrypt = require("bcrypt");

// Show login page
exports.showLogin = (req, res) => {
	res.render('login');
};

// Handle login form
exports.handleLogin = (req, res) => {
	const { username, password } = req.body;
	// Add JWT login here!
	if (username === 'admin' && password === '123') {
		res.redirect('/dashboard');
	} else {
		res.render('login', { error: 'Invalid credentials' });
	}
};

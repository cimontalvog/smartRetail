const path = require('path');
const bcrypt = require("bcrypt");
const grpc = require("@grpc/grpc-js");
const protoLoader = require("@grpc/proto-loader");
const packageDefinition = protoLoader.loadSync("proto/auth.proto");

const authProto = grpc.loadPackageDefinition(packageDefinition).auth;
const authClient = new authProto.AuthService("localhost:50051", grpc.credentials.createInsecure());

// Show login page
exports.showLogin = (req, res) => {
	res.render('login');
};

// Handle login form
exports.handleLogin = (req, res) => {
	const { username, password } = req.body;

	authClient.Login({ username, password }, (err, response) => {
		if (err) {
			console.error('AuthService error:', err);
			return res.render('login', { error: 'Auth service unavailable' });
		}

		console.log(response)

		if (response.success) {
			req.session.token = response.token;
			res.redirect('/dashboard');
		} else {
			res.render('login', { error: 'Invalid credentials' });
		}
	});
};

// Show register page
exports.showRegister = (req, res) => {
	res.render('register');
};

// Handle register form (create new user)
exports.handleRegister = (req, res) => {
	const { username, email, password, confirmPassword } = req.body;

	// Basic form validation (password match)
	if (password !== confirmPassword) {
		return res.render('register', { error: 'Passwords do not match' });
	}

	// Encrypt password
	bcrypt.hash(password, 10, (err, hashedPassword) => {
		if (err) {
			console.error('Error hashing password:', err);
			return res.render('register', { error: 'Registration failed' });
		}

		// Send registration data to Auth service
		authClient.Register({ username, email, password: hashedPassword }, (err, response) => {
			if (err) {
				console.error('AuthService error:', err);
				return res.render('register', { error: 'Auth service unavailable' });
			}

			if (response.success) {
				res.redirect('/login');
			} else {
				res.render('register', { error: 'Registration failed' });
			}
		});
	});
};

// Show dashboard page
exports.showDashboard = (req, res) => {
	console.log("HEY!")
	res.render('dashboard');
};


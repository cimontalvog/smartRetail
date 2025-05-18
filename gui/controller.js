const path = require('path');
const bcrypt = require("bcrypt");
const grpc = require("@grpc/grpc-js");
const protoLoader = require("@grpc/proto-loader");
const authPackageDefinition = protoLoader.loadSync("proto/auth.proto");
const recommendationPackageDefinition = protoLoader.loadSync("proto/recommendation.proto");

const authProto = grpc.loadPackageDefinition(authPackageDefinition).auth;
const authClient = new authProto.AuthService("localhost:50051", grpc.credentials.createInsecure());

const recommendationProto = grpc.loadPackageDefinition(recommendationPackageDefinition).recommendation;
const recommendationClient = new recommendationProto.RecommendationService("localhost:50054", grpc.credentials.createInsecure());

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
			req.session.error = 'Auth service unavailable';
			return res.redirect('/login');
		}

		if (response.success) {
			req.session.token = response.token;
			res.redirect('/dashboard');
		} else {
			req.session.error = 'Invalid credentials';
			res.redirect('/login');
		}
	});
};

// Show register page
exports.showRegister = (req, res) => {
	res.render('register');
};

// Handle register form (create new user)
exports.handleRegister = (req, res) => {
	const { username, password, confirmPassword } = req.body;

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
		authClient.Register({ username, password: hashedPassword }, (err, response) => {
			if (err) {
				console.error('AuthService error:', err);
				req.session.error = 'Auth service unavailable';
				return res.redirect('/register');
			}
			if (response.success) {
				console.log("New user " + username + " has been registered successfully")
				req.session.message = response.message;
				res.redirect('/login');
			} else {
				req.session.error = response.message;
				res.redirect('/register');
			}
		});
	});
};

// Show dashboard page
exports.showDashboard = (req, res) => {
	res.render('dashboard');
};
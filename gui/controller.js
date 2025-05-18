const path = require('path');
const bcrypt = require("bcrypt");
const grpc = require("@grpc/grpc-js");
const protoLoader = require("@grpc/proto-loader");
const authPackageDefinition = protoLoader.loadSync("proto/auth.proto");
const recommendationPackageDefinition = protoLoader.loadSync("proto/recommendation.proto");
const userPackageDefinition = protoLoader.loadSync("proto/user.proto");

const authProto = grpc.loadPackageDefinition(authPackageDefinition).auth;
const authClient = new authProto.AuthService("localhost:50051", grpc.credentials.createInsecure());

const recommendationProto = grpc.loadPackageDefinition(recommendationPackageDefinition).recommendation;
const recommendationClient = new recommendationProto.RecommendationService("localhost:50054", grpc.credentials.createInsecure());

const userProto = grpc.loadPackageDefinition(userPackageDefinition).recommendation;
const userClient = new userProto.UserService("localhost:50055", grpc.credentials.createInsecure());

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
	// Assuming token is in session and is valid for gRPC authentication
	const token = req.session.token;

	// Define the product IDs for which recommendations are needed (could be dynamic based on user preferences)
	const productIds = [1, 2, 3]; // Example product IDs, you may dynamically fetch these
  
	console.log("YES!")

	// Call the gRPC service to get recommended products
	recommendationClient.GetSimilarProducts({ token, productIds }, (err, response) => {
	  if (err) {
		console.log("WHA?")
		console.error('Error fetching recommended products:', err);
		return res.render('dashboard', { error: 'Failed to fetch recommended products' });
	  }
  
	  // Extract the recommended products from the response
	  const recommendedProducts = response.products || [];

	  console.log("HEY2!")
  
	  // Render the dashboard page with the recommended products
	  res.render('dashboard', { recommendedProducts });
	});
};
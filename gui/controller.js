const bcrypt = require("bcrypt");
const grpc = require("@grpc/grpc-js");
const protoLoader = require("@grpc/proto-loader");
const jwt = require('jsonwebtoken');
const authPackageDefinition = protoLoader.loadSync("proto/auth.proto");
const recommendationPackageDefinition = protoLoader.loadSync("proto/recommendation.proto");
const userPackageDefinition = protoLoader.loadSync("proto/user.proto");
const inventoryPackageDefinition = protoLoader.loadSync("proto/inventory.proto");
const checkoutPackageDefinition = protoLoader.loadSync("proto/checkout.proto")

const authProto = grpc.loadPackageDefinition(authPackageDefinition).auth;
const authClient = new authProto.AuthService("localhost:50051", grpc.credentials.createInsecure());

const checkoutProto = grpc.loadPackageDefinition(checkoutPackageDefinition).checkout;
const checkoutClient = new checkoutProto.CheckoutService("localhost:50052", grpc.credentials.createInsecure());

const inventoryProto = grpc.loadPackageDefinition(inventoryPackageDefinition).inventory;
const inventoryClient = new inventoryProto.InventoryService("localhost:50053", grpc.credentials.createInsecure());

const recommendationProto = grpc.loadPackageDefinition(recommendationPackageDefinition).recommendation;
const recommendationClient = new recommendationProto.RecommendationService("localhost:50054", grpc.credentials.createInsecure());

const userProto = grpc.loadPackageDefinition(userPackageDefinition).user;
const userClient = new userProto.UserService("localhost:50055", grpc.credentials.createInsecure());

const SECRET_KEY = "tokensupersecret"; // Secret used for the JWT token

// Show login page
exports.showLogin = (req, res) => {
	console.log("HEY!");
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

exports.showDashboard = (req, res) => {
	const token = req.session.token;

	inventoryClient.GetAllProducts({}, (err, inventoryResponse) => {
		if (err) {
			console.error("Inventory gRPC error:", err);
			return res.status(500).send("Failed to load available products");
		}

		const availableProducts = inventoryResponse.products;

		userClient.GetSimilarProducts({ token }, (err, recommendedResponse) => {
			if (err) {
				if (err.code === grpc.status.UNAUTHENTICATED) {
					req.session.error = "Session expired. Please log in again.";
					return res.redirect('/login');
				}
				console.error("Recommendation gRPC error:", err);
				return res.status(500).send("Failed to load recommended products");
			}

			const recommendedProducts = (recommendedResponse.productIds || [])
				.map(id => availableProducts.find(p => p.id === id))
				.filter(p => p); // Filters out undefined if any ID wasn't found

			userClient.GetUserHistoryProducts({ token }, (err, historyResponse) => {
				if (err) {
					if (err.code === grpc.status.UNAUTHENTICATED) {
						req.session.error = "Session expired. Please log in again.";
						return res.redirect('/login');
					}
					console.error("User gRPC error:", err);
					return res.status(500).send("Failed to load history products");
				}

				try {
					const decoded = jwt.verify(token, SECRET_KEY);
					res.render('dashboard', {
						username: decoded.username,
						history: historyResponse.products,
						available: availableProducts,
						recommended: recommendedProducts,
						cart: []
					});
				} catch (err) {
					console.error("Auth error:", err);
					req.session.error = "Session invalid or expired.";
					return res.redirect('/login');
				}
			});
		});
	});
};

exports.showCheckout = (req, res) => {
	const token = req.session.token;
	const cart = JSON.parse(req.body.cart || '[]');

	try {
		const decoded = jwt.verify(token, SECRET_KEY);
		res.render('checkout', {
			username: decoded.username,
			cart
		});
	} catch (err) {
		console.error("Auth error:", err.message);
		req.session.message = "Please log in again. Your session has expired.";
		return res.redirect('/login');
	}
};


exports.confirmPurchase = (req, res) => {
	const token = req.session.token;

	try {
		const decoded = jwt.verify(token, SECRET_KEY);
		const username = decoded.username;

		const productAndQuantities = JSON.parse(req.body.products).map(p => ({
			id: parseInt(p.id, 10),
			quantity: parseInt(p.quantity, 10)
		}));

		checkoutClient.ConfirmPurchase({ username, productQuantityUpdates: productAndQuantities }, (err, response) => {
			if (err) {
				console.error("Checkout gRPC error:", err.message);
				return res.status(500).send("Checkout failed");
			}
			if (!response.success) {
				return res.status(400).send(response.message);
			}
			exports.showDashboard(req, res);
		});
	} catch (err) {
		console.error("Auth error:", err.message);
		req.session.message = "Please log in again. Your session has expired.";
		return res.redirect('/login');
	}
};

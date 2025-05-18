const bcrypt = require("bcrypt");
const grpc = require("@grpc/grpc-js");
const protoLoader = require("@grpc/proto-loader");
const jwt = require('jsonwebtoken');

// --- Load .proto Definitions ---

// Load protobuf definitions for all microservices
const authPackageDefinition = protoLoader.loadSync("proto/auth.proto");
const recommendationPackageDefinition = protoLoader.loadSync("proto/recommendation.proto");
const userPackageDefinition = protoLoader.loadSync("proto/user.proto");
const inventoryPackageDefinition = protoLoader.loadSync("proto/inventory.proto");
const checkoutPackageDefinition = protoLoader.loadSync("proto/checkout.proto")

// --- Initialize gRPC Clients ---

// Create gRPC clients for each microservice, pointing to their respective local ports
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

const SECRET_KEY = "tokensupersecret"; // JWT secret key for token signing and verification

// --- UI Controller Functions ---

// Show login page
exports.showLogin = (req, res) => {
    console.log("[UI] Displaying login page.");
    res.render('login');
};

// Handle login form submission
exports.handleLogin = (req, res) => {
    const { username, password } = req.body;
    console.log(`[UI] Attempting login for user: ${username}`);

    // Call Auth service Login RPC
    authClient.Login({ username, password }, (err, response) => {
        if (err) {
            console.error('[UI] AuthService error during login:', err);
            req.session.error = 'Auth service unavailable';
            return res.redirect('/login');
        }

        // Handle login response
        if (response.success) {
            console.log(`[UI] User ${username} logged in successfully.`);
            req.session.token = response.token; // Store token in session
            res.redirect('/dashboard');
        } else {
            console.log(`[UI] Login failed for user: ${username}. Invalid credentials.`);
            req.session.error = 'Invalid credentials';
            res.redirect('/login');
        }
    });
};

// Show registration page
exports.showRegister = (req, res) => {
    console.log("[UI] Displaying registration page.");
    res.render('register');
};

// Handle registration form submission
exports.handleRegister = (req, res) => {
    const { username, password, confirmPassword } = req.body;
    console.log(`[UI] Attempting registration for user: ${username}`);

    // Validate matching passwords
    if (password !== confirmPassword) {
        console.warn("[UI] Registration failed: Passwords do not match.");
        return res.render('register', { error: 'Passwords do not match' });
    }

    // Hash password
    bcrypt.hash(password, 10, (err, hashedPassword) => {
        if (err) {
            console.error('[UI] Error hashing password during registration:', err);
            return res.render('register', { error: 'Registration failed' });
        }
        console.log("[UI] Password hashed for new user.");

        // Call Auth service Register RPC
        authClient.Register({ username, password: hashedPassword }, (err, response) => {
            if (err) {
                console.error('[UI] AuthService error during registration:', err);
                req.session.error = 'Auth service unavailable';
                return res.redirect('/register');
            }
            // Handle registration response
            if (response.success) {
                console.log(`[UI] New user ${username} registered successfully.`);
                req.session.message = response.message;
                res.redirect('/login');
            } else {
                console.warn(`[UI] Registration failed for ${username}: ${response.message}`);
                req.session.error = response.message;
                res.redirect('/register');
            }
        });
    });
};

// Show dashboard page
exports.showDashboard = (req, res) => {
    const token = req.session.token;
    console.log("[UI] Attempting to display dashboard.");

    // Get all products from Inventory service
    inventoryClient.GetAllProducts({}, (err, inventoryResponse) => {
        if (err) {
            console.error("[UI] Inventory gRPC error during dashboard load:", err);
            return res.status(500).send("Failed to load available products");
        }
		let inventorySize = inventoryResponse.products ? inventoryResponse.products.length : 0; 
        console.log(`[UI] Fetched ${inventorySize} available products.`);

        const availableProducts = inventoryResponse.products || [];

        // Get recommended products from User service
        userClient.GetSimilarProducts({ token }, (err, recommendedResponse) => {
            if (err) {
                // Handle authentication/gRPC errors
                if (err.code === grpc.status.UNAUTHENTICATED) {
                    console.warn("[UI] Session expired for dashboard access.");
                    req.session.error = "Session expired. Please log in again.";
                    return res.redirect('/login');
                }
                console.error("[UI] Recommendation gRPC error during dashboard load:", err);
                return res.status(500).send("Failed to load recommended products");
            }
			
			let similarSize = recommendedResponse.productIds ? recommendedResponse.productIds.length : 0;
            console.log(`[UI] Fetched ${similarSize} recommended product IDs.`);

            // Map recommended product IDs to full product objects
            const recommendedProducts = (recommendedResponse.productIds || [])
                .map(id => availableProducts.find(p => p.id === id))
                .filter(p => p); // Filter out products not found

            // Get user history products from User service
            userClient.GetUserHistoryProducts({ token }, (err, historyResponse) => {
                if (err) {
                    // Handle authentication/gRPC errors
                    if (err.code === grpc.status.UNAUTHENTICATED) {
                        console.warn("[UI] Session expired during history fetch.");
                        req.session.error = "Session expired. Please log in again.";
                        return res.redirect('/login');
                    }
                    console.error("[UI] User gRPC error during history fetch:", err);
                    return res.status(500).send("Failed to load history products");
					
                }

				let historyProducts = historyResponse.products || [];
				let historySize = historyResponse.products ? historyResponse.products.length : 0;
                console.log(`[UI] Fetched ${historySize} history items.`);


                // Verify JWT token and render dashboard
                try {
                    const decoded = jwt.verify(token, SECRET_KEY);
                    console.log(`[UI] Rendering dashboard for user: ${decoded.username}`);
                    res.render('dashboard', {
                        username: decoded.username,
                        history: historyProducts,
                        available: availableProducts,
                        recommended: recommendedProducts,
                        cart: []
                    });
                } catch (err) {
                    console.error("[UI] JWT verification failed for dashboard:", err);
                    req.session.error = "Session invalid or expired.";
                    return res.redirect('/login');
                }
            });
        });
    });
};

// Show checkout page
exports.showCheckout = (req, res) => {
    const token = req.session.token;
    const cart = JSON.parse(req.body.cart || '[]');
    console.log(`[UI] Displaying checkout page with ${cart.length} items.`);

    // Verify JWT token and render checkout
    try {
        const decoded = jwt.verify(token, SECRET_KEY);
        res.render('checkout', {
            username: decoded.username,
            cart
        });
    } catch (err) {
        console.error("[UI] Auth error showing checkout page:", err.message);
        req.session.message = "Please log in again. Your session has expired.";
        return res.redirect('/login');
    }
};

// Confirm purchase
exports.confirmPurchase = (req, res) => {
    const token = req.session.token;
    console.log("[UI] Received ConfirmPurchase request.");

    // Verify JWT token
    try {
        const decoded = jwt.verify(token, SECRET_KEY);
        const username = decoded.username;
        console.log(`[UI] User ${username} is confirming purchase.`);

        // Parse product and quantity updates
        const productAndQuantities = JSON.parse(req.body.products).map(p => ({
            id: parseInt(p.id, 10),
            quantity: parseInt(p.quantity, 10)
        }));
        console.log(`[UI] Products for purchase: ${JSON.stringify(productAndQuantities)}`);


        // Call Checkout service ConfirmPurchase RPC
        checkoutClient.ConfirmPurchase({ username, productQuantityUpdates: productAndQuantities }, (err, response) => {
            if (err) {
                console.error("[UI] Checkout gRPC error during ConfirmPurchase:", err.message);
                return res.status(500).send("Checkout failed");
            }
            // Handle purchase confirmation response
            if (!response.success) {
                console.warn(`[UI] Purchase confirmation failed: ${response.message}`);
                return res.status(400).send(response.message);
            }
            console.log(`[UI] Purchase confirmed successfully for ${username}.`);
            exports.showDashboard(req, res); // Redirect to dashboard on success
        });
    } catch (err) {
        console.error("[UI] Auth error confirming purchase:", err.message);
        req.session.message = "Please log in again. Your session has expired.";
        return res.redirect('/login');
    }
};
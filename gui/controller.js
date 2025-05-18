const bcrypt = require("bcrypt");
const grpc = require("@grpc/grpc-js");
const protoLoader = require("@grpc/proto-loader");
const jwt = require('jsonwebtoken');

// Load .proto definitions
const authPackageDefinition = protoLoader.loadSync("proto/auth.proto");
const recommendationPackageDefinition = protoLoader.loadSync("proto/recommendation.proto");
const userPackageDefinition = protoLoader.loadSync("proto/user.proto");
const inventoryPackageDefinition = protoLoader.loadSync("proto/inventory.proto");
const checkoutPackageDefinition = protoLoader.loadSync("proto/checkout.proto")

// Initialize gRPC clients
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

const SECRET_KEY = "tokensupersecret"; // JWT secret

// Show login page
exports.showLogin = (req, res) => {
    res.render('login');
};

// Handle login form submission
exports.handleLogin = (req, res) => {
    const { username, password } = req.body;

    // Call Auth service Login RPC
    authClient.Login({ username, password }, (err, response) => {
        if (err) {
            console.error('AuthService error:', err);
            req.session.error = 'Auth service unavailable';
            return res.redirect('/login');
        }

        // Handle login response
        if (response.success) {
            req.session.token = response.token; // Store token
            res.redirect('/dashboard');
        } else {
            req.session.error = 'Invalid credentials';
            res.redirect('/login');
        }
    });
};

// Show registration page
exports.showRegister = (req, res) => {
    res.render('register');
};

// Handle registration form submission
exports.handleRegister = (req, res) => {
    const { username, password, confirmPassword } = req.body;

    // Validate matching passwords
    if (password !== confirmPassword) {
        return res.render('register', { error: 'Passwords do not match' });
    }

    // Hash password
    bcrypt.hash(password, 10, (err, hashedPassword) => {
        if (err) {
            console.error('Error hashing password:', err);
            return res.render('register', { error: 'Registration failed' });
        }

        // Call Auth service Register RPC
        authClient.Register({ username, password: hashedPassword }, (err, response) => {
            if (err) {
                console.error('AuthService error:', err);
                req.session.error = 'Auth service unavailable';
                return res.redirect('/register');
            }
            // Handle registration response
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
    const token = req.session.token;

    // Get all products from Inventory service
    inventoryClient.GetAllProducts({}, (err, inventoryResponse) => {
        if (err) {
            console.error("Inventory gRPC error:", err);
            return res.status(500).send("Failed to load available products");
        }

        const availableProducts = inventoryResponse.products;

        // Get recommended products from User service
        userClient.GetSimilarProducts({ token }, (err, recommendedResponse) => {
            if (err) {
                // Handle authentication/gRPC errors
                if (err.code === grpc.status.UNAUTHENTICATED) {
                    req.session.error = "Session expired. Please log in again.";
                    return res.redirect('/login');
                }
                console.error("Recommendation gRPC error:", err);
                return res.status(500).send("Failed to load recommended products");
            }

            // Map recommended product IDs to full product objects
            const recommendedProducts = (recommendedResponse.productIds || [])
                .map(id => availableProducts.find(p => p.id === id))
                .filter(p => p);

            // Get user history products from User service
            userClient.GetUserHistoryProducts({ token }, (err, historyResponse) => {
                if (err) {
                    // Handle authentication/gRPC errors
                    if (err.code === grpc.status.UNAUTHENTICATED) {
                        req.session.error = "Session expired. Please log in again.";
                        return res.redirect('/login');
                    }
                    console.error("User gRPC error:", err);
                    return res.status(500).send("Failed to load history products");
                }

                // Verify JWT token and render dashboard
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

// Show checkout page
exports.showCheckout = (req, res) => {
    const token = req.session.token;
    const cart = JSON.parse(req.body.cart || '[]');

    // Verify JWT token and render checkout
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

// Confirm purchase
exports.confirmPurchase = (req, res) => {
    const token = req.session.token;

    // Verify JWT token
    try {
        const decoded = jwt.verify(token, SECRET_KEY);
        const username = decoded.username;

        // Parse product and quantity updates
        const productAndQuantities = JSON.parse(req.body.products).map(p => ({
            id: parseInt(p.id, 10),
            quantity: parseInt(p.quantity, 10)
        }));

        // Call Checkout service ConfirmPurchase RPC
        checkoutClient.ConfirmPurchase({ username, productQuantityUpdates: productAndQuantities }, (err, response) => {
            if (err) {
                console.error("Checkout gRPC error:", err.message);
                return res.status(500).send("Checkout failed");
            }
            // Handle purchase confirmation response
            if (!response.success) {
                return res.status(400).send(response.message);
            }
            exports.showDashboard(req, res); // Redirect to dashboard on success
        });
    } catch (err) {
        console.error("Auth error:", err.message);
        req.session.message = "Please log in again. Your session has expired.";
        return res.redirect('/login');
    }
};
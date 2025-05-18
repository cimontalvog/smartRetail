const grpc = require("@grpc/grpc-js"); // gRPC library
const protoLoader = require("@grpc/proto-loader"); // For loading .proto files
const fs = require('fs'); // Node.js File System module
const jwt = require('jsonwebtoken'); // For JSON Web Token (JWT) handling

// --- Configuration and Protocol Buffer Paths ---

// Define paths for Protobuf definitions and the user data file
const USER_PROTO_PATH = "proto/user.proto";
const INVENTORY_PROTO_PATH = "proto/inventory.proto";
const RECOMMENDATION_PROTO_PATH = "proto/recommendation.proto";
const USERS_FILE = "data/users.json";

// --- Data Loading ---

// Load existing users from file; initialize if not found
let users = [];
if (fs.existsSync(USERS_FILE)) {
    users = JSON.parse(fs.readFileSync(USERS_FILE, "utf8"));
}

const SECRET_KEY = "tokensupersecret"; // Secret key for JWTs

// --- Load Protocol Buffer Definitions and Initialize gRPC Clients ---

// Load Protobuf definitions for User, Inventory, and Recommendation services
const userPackageDefinition = protoLoader.loadSync(USER_PROTO_PATH);
const inventoryPackageDefinition = protoLoader.loadSync(INVENTORY_PROTO_PATH);
const recommendationPackageDefinition = protoLoader.loadSync(RECOMMENDATION_PROTO_PATH);

// Get package objects
const userProto = grpc.loadPackageDefinition(userPackageDefinition).user;
const inventoryProto = grpc.loadPackageDefinition(inventoryPackageDefinition).inventory;
const recommendationProto = grpc.loadPackageDefinition(recommendationPackageDefinition).recommendation;

// Create gRPC clients for Inventory and Recommendation services
const inventoryClient = new inventoryProto.InventoryService("localhost:50053", grpc.credentials.createInsecure());
const recommendationClient = new recommendationProto.RecommendationService("localhost:50054", grpc.credentials.createInsecure());

// --- Recommendation Stream Management ---

// Map to store the last received recommendations for each user
const lastRecommendationsMap = new Map(); // Map<username, Product[]>

// Open a bidirectional stream to the Recommendation service
const recommendationBidirectionalStream = recommendationClient.GetSimilarProducts();

// Handle incoming recommended products from the Recommendation service
recommendationBidirectionalStream.on("data", (response) => {
    console.log(response);

    const { username, productIds } = response;

    // Initialize or update the user's last recommendations, keeping only the most recent 3
    if (!lastRecommendationsMap.has(username)) {
        lastRecommendationsMap.set(username, []);
    }
    const existing = lastRecommendationsMap.get(username);
    const updated = existing.concat(productIds || []).slice(3); // Concatenate and keep last 3
    lastRecommendationsMap.set(username, updated);

    console.log(`Updated recommendations for ${username}:`);
    console.log(updated);
});

// Log when the recommendation stream ends
recommendationBidirectionalStream.on("end", () => {
    console.log("Recommendation stream ended.");
});

// Log any errors on the recommendation stream
recommendationBidirectionalStream.on("error", (err) => {
    console.error("Recommendation stream error:", err);
});

// --- UserService Implementation ---

// Implement the RPC methods defined in UserService
const userService = {
    // Updates user recommendations after a checkout (client-streaming RPC)
    UpdateRecommendations: (call, callback) => {
        // Process each incoming data chunk (product IDs checked out by a user)
        call.on("data", (request) => {
            const { username, productIds } = request;
            console.log(`User ${username} checked out products:`, productIds);
            const user = users.find(u => u.username === username);

            // Add new product IDs to user's history and persist
            user.history.push(...productIds);
            fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));

            // Send updated user history to the Recommendation service
            recommendationBidirectionalStream.write({ username, productIds: user.history });
        });

        // Respond when the client stream finishes sending data
        call.on("end", () => {
            callback(null, {}); // Send empty response
        });
    },

    // Retrieves similar products for a user (unary RPC)
    GetSimilarProducts: (call, callback) => {
        const { token } = call.request; // Extract token from request

        let username;
        // Verify JWT token to get username
        try {
            const decoded = jwt.verify(token, SECRET_KEY);
            username = decoded.username;
        } catch (err) {
            console.error("Invalid token:", err.message);
            // Return UNAUTHENTICATED error for invalid token
            return callback({
                code: grpc.status.UNAUTHENTICATED,
                message: "Invalid token",
            });
        }

        console.log("Getting recommended products for " + username);

        // Get last received recommendations from the map
        const productIds = lastRecommendationsMap.get(username) || [];

        // Return recommended product IDs
        callback(null, {
            productIds
        });
    },

    // Retrieves user's purchase history (unary RPC)
    GetUserHistoryProducts: (call, callback) => {
        const { token } = call.request; // Extract token from request

        let username;
        // Verify JWT token to get username
        try {
            const decoded = jwt.verify(token, SECRET_KEY);
            username = decoded.username;
        } catch (err) {
            console.error("Auth error:", err);
            // Return UNAUTHENTICATED error for invalid token
            return callback({
                code: grpc.status.UNAUTHENTICATED,
                message: "Invalid or expired token",
            });
        }

        // Re-read users file to ensure up-to-date data (less efficient for frequent calls)
        if (fs.existsSync(USERS_FILE)) {
            users = JSON.parse(fs.readFileSync(USERS_FILE, "utf8"));
        }

        // Find the user by username
        const user = users.find(u => u.username === username);
        if (!user) {
            // Return NOT_FOUND error if user not found
            return callback({
                code: grpc.status.NOT_FOUND,
                message: "User not found"
            });
        }

        console.log("Getting product history for: " + user.username);

        // Fetch all products from Inventory service to enrich history
        inventoryClient.GetAllProducts({}, (err, response) => {
            if (err) {
                console.error("Inventory service error:", err);
                // Return UNAVAILABLE error if Inventory service fails
                return callback({
                    code: grpc.status.UNAVAILABLE,
                    message: "Failed to fetch products from inventory service"
                });
            }

            const allProducts = response.products;

            // Count quantities of each product in user's history
            const countMap = new Map();
            for (const productId of user.history) {
                countMap.set(productId, (countMap.get(productId) || 0) + 1);
            }

            // Map history IDs to full product objects with quantities
            const products = Array.from(countMap.entries()).map(([id, quantity]) => {
                const product = allProducts.find(p => p.id === id);
                if (!product) return null; // Skip if product details not found

                return {
                    id: product.id,
                    name: product.name,
                    description: product.description,
                    subcategory: product.subcategory,
                    price: product.price,
                    quantity // Quantity from history, not inventory
                };
            }).filter(Boolean); // Filter out any null entries

            // Return the user's purchased products history
            callback(null, { products });
        });
    }
};

// --- gRPC Server Setup and Start ---

// Create a new gRPC server instance
const server = new grpc.Server();

// Add the UserService implementation to the server
server.addService(userProto.UserService.service, userService);

// Bind the server to an address and port, and start it
server.bindAsync("0.0.0.0:50055", grpc.ServerCredentials.createInsecure(), () => {
    console.log("gRPC Recommendation Server running on port 50055...");
});
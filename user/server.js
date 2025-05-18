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

console.log("[USER] Loading user data from file...");
// Load existing users from file; initialize if not found
let users = [];
if (fs.existsSync(USERS_FILE)) {
    users = JSON.parse(fs.readFileSync(USERS_FILE, "utf8"));
    console.log(`[USER] Loaded ${users.length} users from ${USERS_FILE}.`);
} else {
    console.log(`[USER] ${USERS_FILE} not found. Starting with empty user data.`);
}

const SECRET_KEY = "tokensupersecret"; // Secret key for JWTs

// --- Load Protocol Buffer Definitions and Initialize gRPC Clients ---

console.log("[USER] Loading proto definitions and creating gRPC clients...");
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

console.log("[USER] Opening bidirectional stream to Recommendation service...");
// Open a bidirectional stream to the Recommendation service
const recommendationBidirectionalStream = recommendationClient.GetSimilarProducts();

// Handle incoming recommended products from the Recommendation service
recommendationBidirectionalStream.on("data", (response) => {
    console.log(`[USER] Received recommendation update from Recommendation service:`, response);

    const { username, productIds } = response;

    const user = users.find(u => u.username === username);

    // Save last 3 recommendations
    user.lastRecommendations = user.lastRecommendations.concat(productIds || []).slice(-3);
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));

    console.log(`[USER] Stored updated recommendations for ${username}:`, user.lastRecommendations);
});

// Log when the recommendation stream ends
recommendationBidirectionalStream.on("end", () => {
    console.log("[USER] Recommendation stream ended.");
});

// Log any errors on the recommendation stream
recommendationBidirectionalStream.on("error", (err) => {
    console.error("[USER] Recommendation stream error:", err);
});

// --- UserService Implementation ---

// Implement the RPC methods defined in UserService
const userService = {
    // Updates user recommendations after a checkout (client-streaming RPC)
    UpdateRecommendations: (call, callback) => {
        console.log("[USER] New client connected for UpdateRecommendations stream.");
        // Process each incoming data chunk (product IDs checked out by a user)
        call.on("data", (request) => {
            const { username, productIds } = request;
            console.log(`[USER] Received checkout data for ${username}:`, productIds);
            
            // Re-read users file to ensure up-to-date data (less efficient for frequent calls, consider caching)
            if (fs.existsSync(USERS_FILE)) {
                users = JSON.parse(fs.readFileSync(USERS_FILE, "utf8"));
                console.log("[USER] Re-loaded user data for history fetch.");
            }

            const user = users.find(u => u.username === username);

            // Add new product IDs to user's history and persist
            user.history.push(...productIds);
            fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
            console.log(`[USER] Updated history for ${username}. History size: ${user.history.length}`);

            // Send updated user history to the Recommendation service
            recommendationBidirectionalStream.write({ username, productIds: user.history });
            console.log(`[USER] Sent user history to Recommendation service for ${username}.`);
        });

        // Respond when the client stream finishes sending data
        call.on("end", () => {
            console.log("[USER] UpdateRecommendations stream ended by client.");
            callback(null, {}); // Send empty response
        });
    },

    // Retrieves similar products for a user (unary RPC)
    GetSimilarProducts: (call, callback) => {
        console.log("[USER] Received GetSimilarProducts request.");
        const { token } = call.request; // Extract token from request

        let username;
        // Verify JWT token to get username
        try {
            const decoded = jwt.verify(token, SECRET_KEY);
            username = decoded.username;
            console.log(`[USER] Authenticated user for GetSimilarProducts: ${username}`);
        } catch (err) {
            console.error("[USER] Invalid token for GetSimilarProducts:", err.message);
            // Return UNAUTHENTICATED error for invalid token
            return callback({
                code: grpc.status.UNAUTHENTICATED,
                message: "Invalid token",
            });
        }

        // Re-read users file to ensure up-to-date data (less efficient for frequent calls, consider caching)
        if (fs.existsSync(USERS_FILE)) {
            users = JSON.parse(fs.readFileSync(USERS_FILE, "utf8"));
            console.log("[USER] Re-loaded user data for history fetch.");
        }

        const user = users.find(u => u.username === username);

        // Get last received recommendations from the map
        const productIds = user.lastRecommendations || [];
        console.log(`[USER] Retrieved ${productIds.length} recommended products for ${username}.`);

        // Return recommended product IDs
        callback(null, {
            productIds
        });
    },

    // Retrieves user's purchase history (unary RPC)
    GetUserHistoryProducts: (call, callback) => {
        console.log("[USER] Received GetUserHistoryProducts request.");
        const { token } = call.request; // Extract token from request

        let username;
        // Verify JWT token to get username
        try {
            const decoded = jwt.verify(token, SECRET_KEY);
            username = decoded.username;
            console.log(`[USER] Authenticated user for GetUserHistoryProducts: ${username}`);
        } catch (err) {
            console.error("[USER] Auth error getting user history:", err);
            // Return UNAUTHENTICATED error for invalid token
            return callback({
                code: grpc.status.UNAUTHENTICATED,
                message: "Invalid or expired token",
            });
        }

        // Re-read users file to ensure up-to-date data (less efficient for frequent calls, consider caching)
        if (fs.existsSync(USERS_FILE)) {
            users = JSON.parse(fs.readFileSync(USERS_FILE, "utf8"));
            console.log("[USER] Re-loaded user data for history fetch.");
        }

        // Find the user by username
        const user = users.find(u => u.username === username);
        if (!user) {
            console.warn(`[USER] User '${username}' not found for history fetch.`);
            // Return NOT_FOUND error if user not found
            return callback({
                code: grpc.status.NOT_FOUND,
                message: "User not found"
            });
        }

        console.log(`[USER] Fetching product history details for ${user.username}.`);

        // Fetch all products from Inventory service to enrich history details
        inventoryClient.GetAllProducts({}, (err, response) => {
            if (err) {
                console.error("[USER] Inventory service error fetching all products for history:", err);
                // Return UNAVAILABLE error if Inventory service fails
                return callback({
                    code: grpc.status.UNAVAILABLE,
                    message: "Failed to fetch products from inventory service"
                });
            }
            console.log(`[USER] Fetched ${response.products.length} products from Inventory for history enrichment.`);

            const allProducts = response.products;

            // Count quantities of each product in user's history
            const countMap = new Map();
            for (const productId of user.history) {
                countMap.set(productId, (countMap.get(productId) || 0) + 1);
            }
            console.log(`[USER] Counted ${countMap.size} unique items in user history.`);

            // Map history IDs to full product objects with quantities
            const products = Array.from(countMap.entries()).map(([id, quantity]) => {
                const product = allProducts.find(p => p.id === id);
                if (!product) {
                    console.warn(`[USER] Product ID ${id} from history not found in current inventory.`);
                    return null; // Skip if product details not found
                }

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
            console.log(`[USER] Returned ${products.length} enriched history items for ${user.username}.`);
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
    console.log("[USER] gRPC User Server running on port 50055...");
});
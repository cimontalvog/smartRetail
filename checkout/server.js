const grpc = require("@grpc/grpc-js"); // gRPC library
const protoLoader = require("@grpc/proto-loader"); // For loading .proto files
const jwt = require('jsonwebtoken'); // Assuming jwt is imported
const fs = require("fs"); // Node.js File System module

const SECRET_KEY = "tokensupersecret";

// --- Configuration and Protocol Buffer Paths ---

const CHECKOUT_PROTO_PATH = "proto/checkout.proto"; // Path to Checkout service protobuf
const USER_PROTO_PATH = "proto/user.proto"; // Path to User service protobuf
const INVENTORY_PROTO_PATH = "proto/inventory.proto"; // Path to Inventory service protobuf
const STATS_FILE = "data/checkout.json"; // Path for persisting checkout statistics

// --- Load Protocol Buffer Definitions and Initialize gRPC Clients ---

// Load protobuf definitions for the services
const checkoutPackageDefinition = protoLoader.loadSync(CHECKOUT_PROTO_PATH);
const inventoryPackageDefinition = protoLoader.loadSync(INVENTORY_PROTO_PATH);
const userPackageDefinition = protoLoader.loadSync(USER_PROTO_PATH);

// Get the package objects from the loaded definitions
const checkoutProto = grpc.loadPackageDefinition(checkoutPackageDefinition).checkout;
const inventoryProto = grpc.loadPackageDefinition(inventoryPackageDefinition).inventory;
const userProto = grpc.loadPackageDefinition(userPackageDefinition).user;

// Create gRPC clients for Inventory and User services
const inventoryClient = new inventoryProto.InventoryService("localhost:50053", grpc.credentials.createInsecure());
const userClient = new userProto.UserService("localhost:50055", grpc.credentials.createInsecure());

// --- Recommendation Stream Setup ---

// Open a client-side stream to the User service for updating recommendations after checkout
const recommendationsStream = userClient.UpdateRecommendations((err, response) => {
    // Callback for when the stream finishes or encounters an error
    if (err) {
        console.error("[CHECKOUT] Recommendation stream error:", err);
    } else {
        console.log("[CHECKOUT] Recommendation stream closed successfully.");
    }
});

// Handle errors that occur on the recommendation stream
recommendationsStream.on('error', (err) => {
    console.error('[CHECKOUT] Recommendation stream client error:', err.message);
});

// --- Helper Functions for Stats Management ---

// Function to load checkout statistics from a file
function loadStats() {
    console.log("[CHECKOUT] Loading stats...");
    try {
        if (fs.existsSync(STATS_FILE)) {
            return JSON.parse(fs.readFileSync(STATS_FILE, "utf8"));
        }
    } catch (err) {
        console.error("[CHECKOUT] Error reading stats file:", err.message);
    }
    return { totalProductsPurchased: 0, totalMoneySpent: 0 }; // Return default if file not found or error
}

// Function to save checkout statistics to a file
function saveStats(stats) {
    console.log("[CHECKOUT] Saving stats...");
    try {
        fs.writeFileSync(STATS_FILE, JSON.stringify(stats, null, 2));
        console.log("[CHECKOUT] Stats saved.");
    } catch (err) {
        console.error("[CHECKOUT] Error writing stats file:", err.message);
    }
}

// --- CheckoutService Implementation ---

// Implement the RPC methods defined in CheckoutService
const checkoutService = {
    // Handles purchase confirmation requests
    ConfirmPurchase: (call, callback) => {
		console.log("[CHECKOUT] Received ConfirmPurchase request.");
		const { token, productQuantityUpdates } = call.request; // Extract request data

		let username;
		// --- Token Verification Block ---
		try {
			const decoded = jwt.verify(token, SECRET_KEY);
			username = decoded.username;
			console.log(`[CHECKOUT] User ${username} is confirming purchase.`);
		} catch (err) {
			console.error("[CHECKOUT] Token verification failed for ConfirmPurchase:", err.message);
			// Return UNAUTHENTICATED error if token is invalid or expired
			return callback({
				code: grpc.status.UNAUTHENTICATED,
				details: "Invalid or expired authentication token."
			});
		}
		// --- End Token Verification Block ---


		// Get all products from Inventory service (needed for pricing details)
		inventoryClient.GetAllProducts({}, (err, inventoryResponse) => {
			if (err) {
				console.error("[CHECKOUT] Inventory fetch error during ConfirmPurchase:", err.details);
				return callback(null, {
					success: false,
					message: `Inventory fetch failed: ${err.details}`
				});
			}
			console.log("[CHECKOUT] Inventory products fetched successfully.");

			const products = inventoryResponse.products; // All available products

			// Update quantities in the Inventory service
			inventoryClient.UpdateQuantities({ updates: productQuantityUpdates }, (err, res) => {
				if (err) {
					console.error("[CHECKOUT] Inventory update failed during ConfirmPurchase:", err.details);
					return callback(null, {
						success: false,
						message: `Inventory update failed: ${err.details}`
					});
				}
				console.log("[CHECKOUT] Inventory quantities updated successfully.");

				// Aggregate statistics for the current purchase
				const productIds = [];
				let totalQuantity = 0;
				let totalMoney = 0;

				// Loop through updates to calculate totals and gather IDs for recommendations
				for (const update of productQuantityUpdates) {
					if (update.quantity > 0) { // Only consider purchased items (positive quantity)
						const product = products.find(p => p.id === update.id);
						if (product) {
							totalQuantity += update.quantity;
							totalMoney += update.quantity * product.price;

							// Add product IDs multiple times for quantity in history/recommendations
							for (let i = 0; i < update.quantity; i++) {
								productIds.push(update.id);
							}
						}
					}
				}

				// Load existing stats, update with current purchase, and save
				const stats = loadStats();
				stats.totalProductsPurchased += totalQuantity;
				stats.totalMoneySpent += totalMoney;
				saveStats(stats);
				console.log(`[CHECKOUT] Updated global stats for user ${username}.`);


				// Write product IDs to the recommendations stream for user history updates
				recommendationsStream.write({ username, productIds });
				console.log(`[CHECKOUT] Sent recommendation update for user ${username}.`);


				// Respond with success message
				callback(null, {
					success: true,
					message: 'Checkout confirmed, inventory updated, and recommendations sent.'
				});
			});
		});
	},

    // Handles requests to stream real-time checkout statistics to clients
    StreamCheckoutStats: (call) => {
        console.log("[CHECKOUT] New client connected for StreamCheckoutStats.");
        // Set up an interval to send updated stats every 2 seconds
        const intervalId = setInterval(() => {
            const stats = loadStats(); // Load the latest stats
            call.write(stats); // Send stats to the connected client
            console.log("[CHECKOUT] Streaming current stats to client.");
        }, 2000);

        // Clear the interval when the client cancels the stream
        call.on('cancelled', () => {
            clearInterval(intervalId);
            console.log("[CHECKOUT] Client cancelled the StreamCheckoutStats.");
        });
    }
};

// --- gRPC Server Setup and Start ---

// Create a new gRPC server instance
const server = new grpc.Server();

// Add the CheckoutService implementation to the server
server.addService(checkoutProto.CheckoutService.service, checkoutService);

// Bind the server to its designated address and port, then start listening
server.bindAsync("0.0.0.0:50052", grpc.ServerCredentials.createInsecure(), (err, port) => {
    if (err) {
        console.error("[CHECKOUT] Failed to bind gRPC server:", err);
        return;
    }
    console.log(`[CHECKOUT] gRPC Checkout Server running on port ${port}...`);
});
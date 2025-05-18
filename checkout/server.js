const grpc = require("@grpc/grpc-js"); // gRPC library
const protoLoader = require("@grpc/proto-loader"); // For loading .proto files
const fs = require("fs"); // Node.js File System module

// --- Configuration and Protocol Buffer Paths ---

// Define paths for service Protobuf definitions and the stats file
const CHECKOUT_PROTO_PATH = "proto/checkout.proto";
const USER_PROTO_PATH = "proto/user.proto";
const INVENTORY_PROTO_PATH = "proto/inventory.proto";
const STATS_FILE = "data/checkout.json";

// --- Load Protocol Buffer Definitions and Initialize gRPC Clients ---

// Load Protobuf definitions for Checkout, Inventory, and User services
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

// Open a client-side stream to the User service for updating recommendations
const recommendationsStream = userClient.UpdateRecommendations((err, response) => {
    // Callback for when the stream finishes or encounters an error
    if (err) {
        console.error("Recommendation stream error:", err);
    } else {
        console.log("Recommendation stream response:", response);
    }
});

// Handle errors that occur on the recommendation stream
recommendationsStream.on('error', (err) => {
    console.error('Recommendation stream error:', err.message);
});

// --- Helper Functions for Stats Management ---

// Function to load checkout statistics from a file
function loadStats() {
    try {
        if (fs.existsSync(STATS_FILE)) {
            return JSON.parse(fs.readFileSync(STATS_FILE, "utf8"));
        }
    } catch (err) {
        console.error("Error reading stats file:", err.message);
    }
    return { totalProductsPurchased: 0, totalMoneySpent: 0 }; // Return default if file not found or error
}

// Function to save checkout statistics to a file
function saveStats(stats) {
    try {
        fs.writeFileSync(STATS_FILE, JSON.stringify(stats, null, 2));
    } catch (err) {
        console.error("Error writing stats file:", err.message);
    }
}

// --- CheckoutService Implementation ---

// Implement the RPC methods defined in CheckoutService
const checkoutService = {
    // Handles purchase confirmation requests
    ConfirmPurchase: (call, callback) => {
        const { username, productQuantityUpdates } = call.request; // Extract request data

        // Get all products from Inventory service (to get product prices)
        inventoryClient.GetAllProducts({}, (err, inventoryResponse) => {
            if (err) {
                console.error("Inventory fetch error:", err.details);
                return callback(null, {
                    success: false,
                    message: `Inventory fetch failed: ${err.details}`
                });
            }

            const products = inventoryResponse.products; // All available products

            // Update quantities in Inventory service
            inventoryClient.UpdateQuantities({ updates: productQuantityUpdates }, (err, res) => {
                if (err) {
                    console.error("Inventory error:", err.details);
                    return callback(null, {
                        success: false,
                        message: `Inventory update failed: ${err.details}`
                    });
                }

                // Aggregate statistics for the purchase
                const productIds = [];
                let totalQuantity = 0;
                let totalMoney = 0;

                // Loop through product updates to calculate totals and gather IDs
                for (const update of productQuantityUpdates) {
                    if (update.quantity > 0) { // Only count purchases, not returns/cancellations
                        const product = products.find(p => p.id === update.id);
                        if (product) {
                            totalQuantity += update.quantity;
                            totalMoney += update.quantity * product.price;

                            // Add product IDs for recommendation system (repeatedly for quantity)
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

                // Write product IDs to the recommendations stream for the user
                recommendationsStream.write({ username, productIds });

                // Respond with success message
                callback(null, {
                    success: true,
                    message: 'Checkout confirmed, inventory updated, and recommendations sent.'
                });
            });
        });
    },

    // Handles requests to stream real-time checkout statistics
    StreamCheckoutStats: (call) => {
        // Set up an interval to send stats to the client every 2 seconds
        const intervalId = setInterval(() => {
            const stats = loadStats(); // Load latest stats
            call.write(stats); // Send stats to the client
        }, 2000);

        // Clear the interval when the client cancels the stream
        call.on('cancelled', () => {
            clearInterval(intervalId);
            console.log("Client cancelled the stream.");
        });
    }
};

// --- gRPC Server Setup and Start ---

// Create a new gRPC server instance
const server = new grpc.Server();

// Add the CheckoutService implementation to the server
server.addService(checkoutProto.CheckoutService.service, checkoutService);

// Bind the server to an address and port, and start it
server.bindAsync("0.0.0.0:50052", grpc.ServerCredentials.createInsecure(), (err, port) => {
    // Handle binding errors
    if (err) {
        console.error("Failed to bind gRPC server:", err);
        return;
    }
    // Log successful server startup
    console.log(`gRPC Checkout Server running on port ${port}...`);
});
const grpc = require("@grpc/grpc-js"); // gRPC library
const protoLoader = require("@grpc/proto-loader"); // For loading .proto files
const fs = require('fs'); // Node.js File System module

// --- Configuration and Protobuf ---

const INVENTORY_PROTO_PATH = "proto/inventory.proto"; // Path to inventory protobuf definition
const PRODUCTS_FILE = "data/inventory.json"; // Path to product data file

// Load Checkout service protobuf definition
const checkoutPackageDefinition = protoLoader.loadSync("proto/checkout.proto")
const checkoutProto = grpc.loadPackageDefinition(checkoutPackageDefinition).checkout;

// --- gRPC Client for Checkout Service ---

// Create a gRPC client to communicate with the Checkout service
const checkoutClient = new checkoutProto.CheckoutService("localhost:50052", grpc.credentials.createInsecure());

// --- Stream for Checkout Statistics ---

// Initiate a server-streaming RPC call to get real-time checkout statistics
const stream = checkoutClient.StreamCheckoutStats({}, (err, response) => {
    // Initial callback for stream setup
    if (err) {
        console.error("Initial error:", err);
    }
});

// Handle incoming data chunks from the checkout stats stream
stream.on("data", (checkoutStats) => {
    console.log("Received stats:");
    console.log(`    Total Products Purchased: ${checkoutStats.totalProductsPurchased}`);
    console.log(`    Total Money Spent: ${checkoutStats.totalMoneySpent}`);
});

// Log when the server ends the stream
stream.on("end", () => {
    console.log("✅ Stream ended by server.");
});

// Log any errors occurring on the stream
stream.on("error", (err) => {
    console.error("❌ Stream error:", err);
});

// --- Data Loading ---

// Read product data from the inventory file; initialize if file doesn't exist
let products = [];
if (fs.existsSync(PRODUCTS_FILE)) {
    products = JSON.parse(fs.readFileSync(PRODUCTS_FILE, "utf8"));
}

// --- InventoryService Implementation ---

// Load the protobuf definition for the Inventory service
const packageDefinition = protoLoader.loadSync(INVENTORY_PROTO_PATH);
const inventoryProto = grpc.loadPackageDefinition(packageDefinition).inventory;

// Implement the RPC methods for the InventoryService
const inventoryService = {
    // Handles requests to retrieve all available products
    GetAllProducts: (call, callback) => {
        callback(null, { products }); // Return the list of all products
    },

    // Handles requests to update quantities of multiple products
    UpdateQuantities: (call, callback) => {
        const { updates } = call.request; // Extract the array of quantity updates
        const updatedProducts = []; // To store products that were successfully updated

        // Process each individual product quantity update
        for (const { id, quantity } of updates) {
            const product = products.find(p => p.id === id); // Find the product by its ID
            if (product) {
                const newQuantity = product.availableQuantity + quantity; // Calculate the new quantity

                // Validate that the new quantity is not negative
                if (newQuantity < 0) {
                    return callback({
                        code: grpc.status.INVALID_ARGUMENT,
                        details: `Cannot update product ${id}: resulting quantity cannot be negative`
                    });
                }

                product.availableQuantity = newQuantity; // Update the product's quantity
                updatedProducts.push(product); // Add to the list of updated products
            } else {
                // Return an error if the product is not found
                return callback({
                    code: grpc.status.NOT_FOUND,
                    details: `Product with ID ${id} not found`
                });
            }
        }

        // Persist the updated inventory data to the JSON file
        fs.writeFileSync(PRODUCTS_FILE, JSON.stringify(products, null, 2));

        // Return a success response with a message and the list of updated products
        callback(null, {
            message: "Quantities updated successfully",
            updatedProducts
        });
    }

};

// --- gRPC Server Setup and Start ---

// Create a new gRPC server instance
const server = new grpc.Server();
// Add the implemented InventoryService to the gRPC server
server.addService(inventoryProto.InventoryService.service, inventoryService);
// Bind the server to the specified address and port, then start listening for requests
server.bindAsync("0.0.0.0:50053", grpc.ServerCredentials.createInsecure(), () => {
    console.log("gRPC Inventory Server running on port 50053...");
});
const grpc = require("@grpc/grpc-js");
const protoLoader = require("@grpc/proto-loader");
const fs = require('fs');

// Load .proto file
const INVENTORY_PROTO_PATH = "proto/inventory.proto";
const PRODUCTS_FILE = "data/inventory.json";

const checkoutPackageDefinition = protoLoader.loadSync("proto/checkout.proto")

const checkoutProto = grpc.loadPackageDefinition(checkoutPackageDefinition).checkout;
const checkoutClient = new checkoutProto.CheckoutService("localhost:50052", grpc.credentials.createInsecure());

// Maintain a server stream
const checkoutStatsStream = checkoutClient.StreamCheckoutStats();

// Call the server-streaming RPC
const stream = checkoutClient.StreamCheckoutStats({}, (err, response) => {
	if (err) {
		console.error("Initial error:", err);
	}
});

// Handle incoming stream data
stream.on("data", (checkoutStats) => {
	console.log("Received stats:");
	console.log(`    Total Products Purchased: ${checkoutStats.totalProductsPurchased}`);
	console.log(`    Total Money Spent: ${checkoutStats.totalMoneySpent}`);
});

// Handle stream end
stream.on("end", () => {
	console.log("✅ Stream ended by server.");
});

// Handle stream errors
stream.on("error", (err) => {
	console.error("❌ Stream error:", err);
});

// Read products from the file
let products = [];
if (fs.existsSync(PRODUCTS_FILE)) {
    products = JSON.parse(fs.readFileSync(PRODUCTS_FILE, "utf8"));
}

const packageDefinition = protoLoader.loadSync(INVENTORY_PROTO_PATH);

const inventoryProto = grpc.loadPackageDefinition(packageDefinition).inventory;

// Implement the HelloService
const inventoryService = {
    GetAllProducts: (call, callback) => {
		callback(null, { products });
	},

	UpdateQuantities: (call, callback) => {
        const { updates } = call.request;
    
        const updatedProducts = [];
    
        for (const { id, quantity } of updates) {
            const product = products.find(p => p.id === id);
            if (product) {
                const newQuantity = product.availableQuantity + quantity;
    
                if (newQuantity < 0) {
                    return callback({
                        code: grpc.status.INVALID_ARGUMENT,
                        details: `Cannot update product ${id}: resulting quantity cannot be negative`
                    });
                }
    
                product.availableQuantity = newQuantity;
                updatedProducts.push(product);
            } else {
                return callback({
                    code: grpc.status.NOT_FOUND,
                    details: `Product with ID ${id} not found`
                });
            }
        }
    
        // Persist updated inventory
        fs.writeFileSync(PRODUCTS_FILE, JSON.stringify(products, null, 2));
    
        callback(null, {
            message: "Quantities updated successfully",
            updatedProducts
        });
    }
    
};

// Start gRPC Server
const server = new grpc.Server();
server.addService(inventoryProto.InventoryService.service, inventoryService);
server.bindAsync("0.0.0.0:50053", grpc.ServerCredentials.createInsecure(), () => {
    console.log("gRPC Inventory Server running on port 50053...");
});
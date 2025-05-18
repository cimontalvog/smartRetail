const grpc = require("@grpc/grpc-js");
const protoLoader = require("@grpc/proto-loader");
const fs = require("fs");

const CHECKOUT_PROTO_PATH = "proto/checkout.proto";
const USER_PROTO_PATH = "proto/user.proto";
const INVENTORY_PROTO_PATH = "proto/inventory.proto";
const STATS_FILE = "data/checkout.json";

// Load proto definitions
const checkoutPackageDefinition = protoLoader.loadSync(CHECKOUT_PROTO_PATH);
const inventoryPackageDefinition = protoLoader.loadSync(INVENTORY_PROTO_PATH);
const userPackageDefinition = protoLoader.loadSync(USER_PROTO_PATH);

const checkoutProto = grpc.loadPackageDefinition(checkoutPackageDefinition).checkout;
const inventoryProto = grpc.loadPackageDefinition(inventoryPackageDefinition).inventory;
const userProto = grpc.loadPackageDefinition(userPackageDefinition).user;

const inventoryClient = new inventoryProto.InventoryService("localhost:50053", grpc.credentials.createInsecure());
const userClient = new userProto.UserService("localhost:50055", grpc.credentials.createInsecure());

// Open stream once
const recommendationsStream = userClient.UpdateRecommendations((err, response) => {
	if (err) {
		console.error("Recommendation stream error:", err);
	} else {
		console.log("Recommendation stream response:", response);
	}
});

recommendationsStream.on('error', (err) => {
	console.error('Recommendation stream error:', err.message);
});

function loadStats() {
	try {
		if (fs.existsSync(STATS_FILE)) {
			return JSON.parse(fs.readFileSync(STATS_FILE, "utf8"));
		}
	} catch (err) {
		console.error("Error reading stats file:", err.message);
	}
	return {};
}

function saveStats(stats) {
	try {
		fs.writeFileSync(STATS_FILE, JSON.stringify(stats, null, 2));
	} catch (err) {
		console.error("Error writing stats file:", err.message);
	}
}

const checkoutService = {
	ConfirmPurchase: (call, callback) => {
		const { username, productQuantityUpdates } = call.request;
	
		inventoryClient.GetAllProducts({}, (err, inventoryResponse) => {
			if (err) {
				console.error("Inventory fetch error:", err.details);
				return callback(null, {
					success: false,
					message: `Inventory fetch failed: ${err.details}`
				});
			}
	
			const products = inventoryResponse.products;
	
			inventoryClient.UpdateQuantities({ updates: productQuantityUpdates }, (err, res) => {
				if (err) {
					console.error("Inventory error:", err.details);
					return callback(null, {
						success: false,
						message: `Inventory update failed: ${err.details}`
					});
				}
	
				// Aggregate stats
				const productIds = [];
				let totalQuantity = 0;
				let totalMoney = 0;
	
				for (const update of productQuantityUpdates) {
					if (update.quantity > 0) {
						const product = products.find(p => p.id === update.id);
						if (product) {
							totalQuantity += update.quantity;
							totalMoney += update.quantity * product.price;
	
							for (let i = 0; i < update.quantity; i++) {
								productIds.push(update.id);
							}
						}
					}
				}
	
				// ✅ Update flat stats
				const stats = loadStats(); // Should return { totalProductsPurchased, totalMoneySpent }
	
				stats.totalProductsPurchased += totalQuantity;
				stats.totalMoneySpent += totalMoney;
	
				saveStats(stats);
	
				// ✅ Stream recommendations
				recommendationsStream.write({ username, productIds });
	
				// ✅ Respond
				callback(null, {
					success: true,
					message: 'Checkout confirmed, inventory updated, and recommendations sent.'
				});
			});
		});
	},

	StreamCheckoutStats: (call) => {
		const intervalId = setInterval(() => {
			const stats = loadStats();
	
			call.write(stats);
		}, 2000); // every 2 seconds
	
		call.on('cancelled', () => {
			clearInterval(intervalId);
			console.log("Client cancelled the stream.");
		});
	}
	
};

// Start gRPC Server
const server = new grpc.Server();
server.addService(checkoutProto.CheckoutService.service, checkoutService);
server.bindAsync("0.0.0.0:50052", grpc.ServerCredentials.createInsecure(), (err, port) => {
	if (err) {
		console.error("Failed to bind gRPC server:", err);
		return;
	}
	console.log(`gRPC Checkout Server running on port ${port}...`);
});

const grpc = require("@grpc/grpc-js");
const protoLoader = require("@grpc/proto-loader");

// Load .proto file
const CHECKOUT_PROTO_PATH = "proto/checkout.proto";
const USER_PROTO_PATH = "proto/user.proto";
const INVENTORY_PROTO_PATH = "proto/inventory.proto"

// Load .proto file
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

const checkoutService = {
    ConfirmPurchase: (call, callback) => {
        console.log(call);
		const { username, productQuantityUpdates } = call.request;

        console.log(productQuantityUpdates)

		// Call inventory service to update quantities
		inventoryClient.UpdateQuantities({ updates: productQuantityUpdates }, (err, res) => {
			if (err) {
				console.error("Inventory error:", err.details);
				return callback(null, {
					success: false,
					message: `Inventory update failed: ${err.details}`
				});
			}

			// Generate productIds array for recommendations stream
			const productIds = [];
			for (const update of productQuantityUpdates) {
				if (update.quantity > 0) {
					for (let i = 0; i < update.quantity; i++) {
						productIds.push(update.id);
					}
				}
			}

			// Write to recommendations stream
			recommendationsStream.write({ username, productIds });

			// Respond to checkout client
			callback(null, {
				success: true,
				message: 'Checkout confirmed, inventory updated, and recommendations sent.'
			});
		});
	}
};

// Start gRPC Server
const server = new grpc.Server();
server.addService(checkoutProto.CheckoutService.service, checkoutService);
server.bindAsync("0.0.0.0:50052", grpc.ServerCredentials.createInsecure(), () => {
    console.log("gRPC Checkout Server running on port 50052...");
});

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

const inventoryClient = new inventoryProto.UserService("localhost:50053", grpc.credentials.createInsecure());
const userClient = new userProto.UserService("localhost:50055", grpc.credentials.createInsecure());

// Recommendations stream (kept open indefinitely)
const recommendationsStream = userClient.UpdateRecommendations();

recommendationsStream.on('error', (err) => {
	console.error('Recommendation stream error:', err.message);
});

const checkoutService = {
    ConfirmCart: (call, callback) => {
		const { username, productQuantityUpdates } = call.request;

        //TODO
        //Call inventoryClient.UpdateQuantities with same params as 

		// Send recommendations via open stream
		recommendationsStream.write({ username, productIds });

		// Reply to client
		callback(null, { success: true, message: 'Checkout confirmed and recommendations sent' });
	}
};

// Start gRPC Server
const server = new grpc.Server();
server.addService(checkoutService.CheckoutService.service, checkoutService);
server.bindAsync("0.0.0.0:50052", grpc.ServerCredentials.createInsecure(), () => {
    console.log("gRPC Checkout Server running on port 50052...");
});

const grpc = require("@grpc/grpc-js");
const protoLoader = require("@grpc/proto-loader");

// Load .proto file
const CHECKOUT_PROTO_PATH = "proto/checkout.proto";

// Load .proto file
const packageDefinition = protoLoader.loadSync(CHECKOUT_PROTO_PATH);

const checkoutProto = grpc.loadPackageDefinition(packageDefinition).checkout;

// Implement the HelloService
const checkoutService = {
    
};

// Start gRPC Server
const server = new grpc.Server();
server.addService(checkoutService.CheckoutService.service, checkoutService);
server.bindAsync("0.0.0.0:50052", grpc.ServerCredentials.createInsecure(), () => {
    console.log("gRPC Checkout Server running on port 50052...");
});

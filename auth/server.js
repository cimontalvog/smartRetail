const grpc = require("@grpc/grpc-js");
const protoLoader = require("@grpc/proto-loader");

// Load .proto file
const PROTO_PATH = "./auth.proto";
const packageDefinition = protoLoader.loadSync(PROTO_PATH);

const authProto = grpc.loadPackageDefinition(packageDefinition).auth;

// Implement the AuthService
const authService = {
    Login: (call, callback) => {
        const name = call.request.name || "World";
        console.log("Response generated!");
        callback(null, { message: `Hello, ${name}!` });
    },
    Register:(call, callback) => {

    }
};

// Start gRPC Server
const server = new grpc.Server();
server.addService(authProto.AuthService.service, authService);
server.bindAsync("0.0.0.0:50051", grpc.ServerCredentials.createInsecure(), () => {
    console.log("gRPC Auth Server running on port 50051...");
});

const grpc = require("@grpc/grpc-js");
const protoLoader = require("@grpc/proto-loader");

// Load .proto file
const PROTO_PATH = "./hello.proto";
const packageDefinition = protoLoader.loadSync(PROTO_PATH);

const helloProto = grpc.loadPackageDefinition(packageDefinition).hello;

// Implement the HelloService
const helloService = {
    SayHello: (call, callback) => {
        const name = call.request.name || "World";
        console.log("Response generated!");
        callback(null, { message: `Hello, ${name}!` });
    }
};

// Start gRPC Server
const server = new grpc.Server();
server.addService(helloProto.HelloService.service, helloService);
server.bindAsync("0.0.0.0:50052", grpc.ServerCredentials.createInsecure(), () => {
    console.log("gRPC Hello Server running on port 50052...");
});

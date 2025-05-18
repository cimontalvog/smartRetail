const grpc = require("@grpc/grpc-js");
const protoLoader = require("@grpc/proto-loader");
const fs = require('fs');
const jwt = require('jsonwebtoken');

// Load .proto files
const USER_PROTO_PATH = "proto/user.proto";
const RECOMMENDATION_PROTO_PATH = "proto/recommendation.proto";

const SECRET_KEY = "tokensupersecret"; // Secret used for the JWT token
const userPackageDefinition = protoLoader.loadSync(USER_PROTO_PATH);
const recommendationPackageDefinition = protoLoader.loadSync(RECOMMENDATION_PROTO_PATH);

const userProto = grpc.loadPackageDefinition(packageDefinition).user;

const recommendationProto = grpc.loadPackageDefinition(recommendationPackageDefinition).recommendation;
const recommendationClient = new recommendationProto.RecommendationService("localhost:50054", grpc.credentials.createInsecure());

// Maintain a bi-directional stream
const stream = recommendationClient.GetSimilarProducts();

// Handle incoming recommended products from the server
stream.on("data", (username, product) => {
    // Update username here and use a Map
    // TODO
	// Update the last recommendations
	lastRecommendations.push(product);

	// Keep only last 5
	if (lastRecommendations.length > 5) {
		lastRecommendations = lastRecommendations.slice(-5);
	}

	console.log("Received product recommendation:", product);
});

stream.on("end", () => {
	console.log("Recommendation stream ended.");
});

stream.on("error", (err) => {
	console.error("Recommendation stream error:", err);
});

// Implement the UserService
const userService = {
    // Every checkout, update recommended products for X username
    UpdateRecommendations: (call, callback) => {
		call.on("data", (request) => {
			const { username, productIds } = request;
			console.log(`User ${username} checked out products:`, productIds);
            stream.write({ username, productIds });
			// You can now update internal recommendation data here
		});

		call.on("end", () => {
			// All data sent by client is received
			callback(null, {}); // Send empty response
		});
	}
    // Unary from Dashboard regarding recommended
    // Bi-directional (this maybe in recommendation(?) and call i from here)
    // Unary cart from dashboard
    // Cart streaming
};

// Start gRPC Server
const server = new grpc.Server();
server.addService(userProto.UserService.service, userService);
server.bindAsync("0.0.0.0:50055", grpc.ServerCredentials.createInsecure(), () => {
    console.log("gRPC Recommendation Server running on port 50055...");
});


const grpc = require("@grpc/grpc-js");
const protoLoader = require("@grpc/proto-loader");
const fs = require('fs');
const jwt = require('jsonwebtoken');

// Load .proto files
const USER_PROTO_PATH = "proto/user.proto";
const INVENTORY_PROTO_PATH = "proto/inventory.proto";
const RECOMMENDATION_PROTO_PATH = "proto/recommendation.proto";

const USERS_FILE = "data/users.json";

// Read users from the file
let users = [];
if (fs.existsSync(USERS_FILE)) {
    users = JSON.parse(fs.readFileSync(USERS_FILE, "utf8"));
}

const SECRET_KEY = "tokensupersecret"; // Secret used for the JWT token
const userPackageDefinition = protoLoader.loadSync(USER_PROTO_PATH);
const inventoryPackageDefinition = protoLoader.loadSync(INVENTORY_PROTO_PATH);
const recommendationPackageDefinition = protoLoader.loadSync(RECOMMENDATION_PROTO_PATH);

const userProto = grpc.loadPackageDefinition(userPackageDefinition).user;

const inventoryProto = grpc.loadPackageDefinition(inventoryPackageDefinition).inventory;
const inventoryClient = new inventoryProto.InventoryService("localhost:50053", grpc.credentials.createInsecure());

const recommendationProto = grpc.loadPackageDefinition(recommendationPackageDefinition).recommendation;
const recommendationClient = new recommendationProto.RecommendationService("localhost:50054", grpc.credentials.createInsecure());

const lastRecommendationsMap = new Map(); // Map<username, Product[]>

// Maintain a bi-directional stream
const recommendationBidirectionalStream = recommendationClient.GetSimilarProducts();

const recommendationServerStream = recommendationClient.GetSimilarProducts();

// Handle incoming recommended products from the server
recommendationBidirectionalStream.on("data", (response) => {
    console.log(response);

    const { username, productIds } = response;

	if (!lastRecommendationsMap.has(username)) {
		lastRecommendationsMap.set(username, []);
	}

	const existing = lastRecommendationsMap.get(username);
	const updated = existing.concat(productIds || []).slice(3); // Keep only first 3
	lastRecommendationsMap.set(username, updated);

	console.log(`Updated recommendations for ${username}:`);
	console.log(updated);
});

recommendationBidirectionalStream.on("end", () => {
	console.log("Recommendation stream ended.");
});

recommendationBidirectionalStream.on("error", (err) => {
	console.error("Recommendation stream error:", err);
});

// Implement the UserService
const userService = {
    // Every checkout, update recommended products for X username (client streaming)
    UpdateRecommendations: (call, callback) => {
		call.on("data", (request) => {
			const { username, productIds } = request;
			console.log(`User ${username} checked out products:`, productIds);
            const user = users.find(u => u.username === username);

            user.history.push(...productIds);
            
            fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));

            recommendationBidirectionalStream.write({ username, productIds: user.history });
		});

		call.on("end", () => {
			// All data sent by client is received
			callback(null, {}); // Send empty response
		});
	},
    // Unary from Dashboard regarding recommended
    GetSimilarProducts: (call, callback) => {
		const { token } = call.request;

		let username;
		try {
			const decoded = jwt.verify(token, SECRET_KEY);
			username = decoded.username;
		} catch (err) {
			console.error("Invalid token:", err.message);
			return callback({
				code: grpc.status.UNAUTHENTICATED,
				message: "Invalid token",
			});
		}

        console.log("Getting recommended products for " + username);

		const productIds = lastRecommendationsMap.get(username) || [];

		// Return the full list of products (repeated field)
		callback(null, {
			productIds // assumed to be array of Product messages
		});
	},
    GetUserHistoryProducts: (call, callback) => {
        const { token } = call.request;
    
        let username;
        try {
            const decoded = jwt.verify(token, SECRET_KEY);
            username = decoded.username;
        } catch (err) {
            console.error("Auth error:", err);
            return callback({
                code: grpc.status.UNAUTHENTICATED,
                message: "Invalid or expired token",
            });
        }

        if (fs.existsSync(USERS_FILE)) {
            users = JSON.parse(fs.readFileSync(USERS_FILE, "utf8"));
        }
    
        const user = users.find(u => u.username === username);
        if (!user) {
            return callback({
                code: grpc.status.NOT_FOUND,
                message: "User not found"
            });
        }

        console.log("Getting product history for: " + user.username);
    
        // Call the inventory service to get all products
        inventoryClient.GetAllProducts({}, (err, response) => {
            if (err) {
                console.error("Inventory service error:", err);
                return callback({
                    code: grpc.status.UNAVAILABLE,
                    message: "Failed to fetch products from inventory service"
                });
            }
    
            const allProducts = response.products;
    
            // Count quantities from user history
            const countMap = new Map();
            for (const productId of user.history) {
                countMap.set(productId, (countMap.get(productId) || 0) + 1);
            }
    
            const products = Array.from(countMap.entries()).map(([id, quantity]) => {
                const product = allProducts.find(p => p.id === id);
                if (!product) return null;
    
                return {
                    id: product.id,
                    name: product.name,
                    description: product.description,
                    subcategory: product.subcategory,
                    price: product.price,
                    quantity
                };
            }).filter(Boolean);
    
            callback(null, { products });
        });
    }
};

// Start gRPC Server
const server = new grpc.Server();
server.addService(userProto.UserService.service, userService);
server.bindAsync("0.0.0.0:50055", grpc.ServerCredentials.createInsecure(), () => {
    console.log("gRPC Recommendation Server running on port 50055...");
});


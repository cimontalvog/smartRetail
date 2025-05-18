const grpc = require("@grpc/grpc-js");
const protoLoader = require("@grpc/proto-loader");
const fs = require('fs');

// Load .proto file
const RECOMMENDATION_PROTO_PATH = "proto/recommendation.proto";
const PRODUCTS_FILE = "data/inventory.json";

// Read products from the file
let products = [];
if (fs.existsSync(PRODUCTS_FILE)) {
    products = JSON.parse(fs.readFileSync(PRODUCTS_FILE, "utf8"));
}

const packageDefinition = protoLoader.loadSync(RECOMMENDATION_PROTO_PATH);

const recommendationProto = grpc.loadPackageDefinition(packageDefinition).recommendation;

// Using a KNN weighted metric for recommendations, that includes subcategory and prices regarding
// previously purchased products
const w1 = 0.7;
const w2 = 0.3;

const recommendationService = {
	GetSimilarProducts: (call) => {
		call.on("data", (request) => {
			const { username, productIds } = request;
	
			const result = getSimilarProducts(productIds, products);
	
			call.write({
				username,
				products: result, // This is a list of Product messages
			});
		});
	
		call.on("end", () => {
			call.end(); // End the response stream when client is done
		});
	
		call.on("error", (err) => {
			console.error("Stream error:", err);
		});
	}
};

function getSimilarProducts(productIds, allProducts) {
	const purchased = allProducts.filter(p => productIds.includes(p.id));
	if (purchased.length === 0) return [];

	const maxPriceDiff = Math.max(
		...allProducts.flatMap(p1 =>
			purchased.map(p2 => Math.abs(p1.price - p2.price))
		)
	) || 1;

	// Slight randomization per request
	const w1 = 0.6 + Math.random() * 0.2; // [0.6 - 0.8]
	const w2 = 1 - w1;                    // keep sum = 1

	const scored = allProducts
		.filter(p => !productIds.includes(p.id))
		.map(p => {
			let totalScore = 0;

			for (const target of purchased) {
				const subcategory_score = (p.subcategory && target.subcategory && p.subcategory === target.subcategory) ? 1 : 0;
				const price_diff = Math.abs(p.price - target.price);
				const normalized_price_diff = 1 - (price_diff / maxPriceDiff);
				const score = w1 * subcategory_score + w2 * normalized_price_diff;
				totalScore += score;
			}

			const avgScore = totalScore / purchased.length;
			return { ...p, score: avgScore };
		})
		.sort((a, b) => b.score - a.score)
		.slice(0, 5);

	return scored.map(({ id, name, subcategory, price }) => ({
		id, name, subcategory, price
	}));
}

// Start gRPC Server
const server = new grpc.Server();
server.addService(recommendationProto.RecommendationService.service, recommendationService);
server.bindAsync("0.0.0.0:50054", grpc.ServerCredentials.createInsecure(), () => {
    console.log("gRPC Recommendation Server running on port 50054...");
});

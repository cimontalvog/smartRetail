const grpc = require("@grpc/grpc-js");
const protoLoader = require("@grpc/proto-loader");
const fs = require('fs');

// Load .proto file
const RECOMMENDATION_PROTO_PATH = "proto/recommendation.proto";
const PRODUCTS_FILE = "data/inventory.json";

// Add a recommendations.json that saves recommendations info
// Use inventory.getAllProducts instead of loading inventory.json

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

			console.log(request);
	
			const result = getSimilarProducts(productIds, products);

			console.log(result);
	
			call.write({
				username,
				productIds: result, // This is a list of Product messages
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

/**
 * Returns a list of product IDs that are most similar to the ones already purchased.
 *
 * @param {number[]} productIds - Array of product IDs that the user has already purchased.
 * @param {Object[]} allProducts - Array of all available product objects, each with `id`, `price`, and `subcategory`.
 * @returns {number[]} - Array of recommended product IDs, sorted by descending similarity.
 */
function getSimilarProducts(productIds, allProducts) {
	// Step 1: Extract the list of purchased products from the full product catalog
	const purchased = allProducts.filter(p => productIds.includes(p.id));

	// If no purchases yet, we can't calculate similarity — return empty list
	if (!purchased.length) return [];

	// Step 2: Compute the maximum price difference between any purchased product and all products.
	// This is used to normalize price differences later so that the scoring scale is consistent.
	const maxPriceDiff = Math.max(
		...purchased.flatMap(p1 =>
			allProducts.map(p2 => Math.abs(p1.price - p2.price))
		)
	) || 1; // Avoid division by zero by defaulting to 1 if all prices are the same

	// Step 3: Generate random weights for the two scoring factors:
	// - w1: weight for subcategory similarity
	// - w2: weight for price proximity
	// These weights introduce slight randomization for freshness in recommendations
	const [w1, w2] = (() => {
		const w1 = 0.6 + Math.random() * 0.2; // Random value between 0.6 and 0.8
		return [w1, 1 - w1]; // Ensure weights sum to 1
	})();

	// Step 4: For each non-purchased product, calculate a similarity score
	// The score is based on two factors:
	//   - Whether the subcategory matches any purchased product
	//   - How close the price is to purchased products (closer is better)
	const scored = allProducts
		.filter(p => !productIds.includes(p.id)) // Only consider products not already purchased
		.map(p => {
			// For each product, compute the average similarity score against all purchased products
			const scoreSum = purchased.reduce((sum, target) => {
				// Check if the subcategory is the same (1 for match, 0 for mismatch)
				const sameSub = p.subcategory === target.subcategory ? 1 : 0;

				// Normalize the price difference to a 0-1 range, where 1 means very similar price
				const priceScore = 1 - Math.abs(p.price - target.price) / maxPriceDiff;

				// Combine the two components using weighted average
				const similarity = w1 * sameSub + w2 * priceScore;

				// Accumulate score
				return sum + similarity;
			}, 0);

			// Average the total score across all purchased products
			const avgScore = scoreSum / purchased.length;

			// Return the product with its calculated score
			return { ...p, score: avgScore };
		})

		// Step 5: Sort the scored products in descending order of similarity
		.sort((a, b) => b.score - a.score)

		// Step 6: Take the top 3 most similar products
		.slice(0, 3)

		// Step 7: Return only their IDs
		.map(p => p.id);

	return scored;
}


// Start gRPC Server
const server = new grpc.Server();
server.addService(recommendationProto.RecommendationService.service, recommendationService);
server.bindAsync("0.0.0.0:50054", grpc.ServerCredentials.createInsecure(), () => {
    console.log("gRPC Recommendation Server running on port 50054...");
});

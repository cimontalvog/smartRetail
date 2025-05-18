const grpc = require("@grpc/grpc-js"); // gRPC library
const protoLoader = require("@grpc/proto-loader"); // For loading .proto files
const fs = require('fs'); // Node.js File System module

// --- Configuration and Protobuf ---

const RECOMMENDATION_PROTO_PATH = "proto/recommendation.proto"; // Path to recommendation protobuf definition
const INVENTORY_PROTO_PATH = "proto/inventory.proto"; // Path to inventory protobuf definition

// Load protobuf definitions
const packageDefinition = protoLoader.loadSync(RECOMMENDATION_PROTO_PATH);
const inventoryPackageDefinition = protoLoader.loadSync(INVENTORY_PROTO_PATH);

// Get package objects
const recommendationProto = grpc.loadPackageDefinition(packageDefinition).recommendation;
const inventoryProto = grpc.loadPackageDefinition(inventoryPackageDefinition).inventory;

// Create Inventory service client
const inventoryClient = new inventoryProto.InventoryService("localhost:50053", grpc.credentials.createInsecure());

// --- Recommendation Service Implementation ---

const recommendationService = {
    // Handles bidirectional streaming for similar products
    GetSimilarProducts: (call) => {
        console.log("[RECOMMENDATION] New client connected for GetSimilarProducts stream.");
        // Process incoming client data
        call.on("data", (request) => {
            const { username, productIds } = request;

            console.log(`[RECOMMENDATION] Received data for user ${username}:`, request);

            // Fetch all products from Inventory service
            inventoryClient.GetAllProducts({}, (err, inventoryResponse) => {
                if (err) {
                    console.error("[RECOMMENDATION] Inventory gRPC error during GetSimilarProducts:", err);
                    return; // Fail silently or handle stream error more robustly
                }
                console.log(`[RECOMMENDATION] Fetched ${inventoryResponse.products.length} products from Inventory.`);

                const products = inventoryResponse.products;

                // Calculate similar products
                const result = getSimilarProducts(productIds, products);

                console.log(`[RECOMMENDATION] Calculated similar products for ${username}:`, result);

                // Write recommended product IDs back to client stream
                call.write({
                    username,
                    productIds: result,
                });
                console.log(`[RECOMMENDATION] Sent recommendations to client for ${username}.`);
            });
        });

        // End response stream when client stream ends
        call.on("end", () => {
            console.log("[RECOMMENDATION] Client stream ended.");
            call.end();
        });

        // Log stream errors
        call.on("error", (err) => {
            console.error("[RECOMMENDATION] Stream error:", err);
        });
    }
};

/**
 * Recommends products based on similarity to purchased items.
 * @param {number[]} productIds - IDs of products already purchased.
 * @param {Object[]} allProducts - All available products.
 * @returns {number[]} - IDs of recommended products.
 */
function getSimilarProducts(productIds, allProducts) {
    const purchased = allProducts.filter(p => productIds.includes(p.id));

    if (!purchased.length) {
        console.log("[RECOMMENDATION] No purchased products found for similarity calculation. Returning empty recommendations.");
        return [];
    }
    console.log(`[RECOMMENDATION] Calculating similarity for ${purchased.length} purchased products.`);


    // Calculate max price difference for normalization
    const maxPriceDiff = Math.max(
        ...purchased.flatMap(p1 =>
            allProducts.map(p2 => Math.abs(p1.price - p2.price))
        )
    ) || 1;
    console.log(`[RECOMMENDATION] Max price difference for normalization: ${maxPriceDiff}`);


    // Generate random weights for subcategory and price
    const [w1, w2] = (() => {
        const w1 = 0.6 + Math.random() * 0.2; // Subcategory weight (0.6 to 0.8)
        return [w1, 1 - w1]; // Price weight (0.2 to 0.4), sum to 1
    })();
    console.log(`[RECOMMENDATION] Generated weights: w1 (subcategory)=${w1.toFixed(2)}, w2 (price)=${w2.toFixed(2)}`);


    // Score and sort non-purchased products
    const scored = allProducts
        .filter(p => !productIds.includes(p.id)) // Exclude already purchased
        .map(p => {
            const scoreSum = purchased.reduce((sum, target) => {
                const sameSub = p.subcategory === target.subcategory ? 1 : 0; // 1 if subcategory matches, 0 otherwise
                const priceScore = 1 - Math.abs(p.price - target.price) / maxPriceDiff; // Normalized price similarity
                const similarity = w1 * sameSub + w2 * priceScore; // Weighted combined similarity
                return sum + similarity;
            }, 0);

            const avgScore = scoreSum / purchased.length; // Average score across all purchased items
            return { ...p, score: avgScore };
        })
        .sort((a, b) => b.score - a.score) // Sort by score in descending order
        .slice(0, 3) // Take the top 3 recommendations
        .map(p => p.id); // Return only product IDs
    console.log(`[RECOMMENDATION] Identified top 3 recommended product IDs.`);


    return scored;
}

// --- gRPC Server Setup ---

const server = new grpc.Server();
server.addService(recommendationProto.RecommendationService.service, recommendationService);

// Bind and start the server
server.bindAsync("0.0.0.0:50054", grpc.ServerCredentials.createInsecure(), () => {
    console.log("[RECOMMENDATION] gRPC Recommendation Server running on port 50054...");
});
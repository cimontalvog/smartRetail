const grpc = require("@grpc/grpc-js");
const protoLoader = require("@grpc/proto-loader");
const fs = require('fs');

// --- Configuration and Protobuf ---

const RECOMMENDATION_PROTO_PATH = "proto/recommendation.proto";
const INVENTORY_PROTO_PATH = "proto/inventory.proto";

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
        // Process incoming client data
        call.on("data", (request) => {
            const { username, productIds } = request;

            console.log(request);

            // Fetch all products from Inventory service
            inventoryClient.GetAllProducts({}, (err, inventoryResponse) => {
                if (err) {
                    console.error("Inventory gRPC error:", err);
                    return; // Fail silently or handle stream error more robustly
                }

                const products = inventoryResponse.products;

                // Calculate similar products
                const result = getSimilarProducts(productIds, products);

                console.log(result);

                // Write recommended product IDs back to client stream
                call.write({
                    username,
                    productIds: result,
                });
            });
        });

        // End response stream when client stream ends
        call.on("end", () => {
            call.end();
        });

        // Log stream errors
        call.on("error", (err) => {
            console.error("Stream error:", err);
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

    if (!purchased.length) return [];

    // Calculate max price difference for normalization
    const maxPriceDiff = Math.max(
        ...purchased.flatMap(p1 =>
            allProducts.map(p2 => Math.abs(p1.price - p2.price))
        )
    ) || 1;

    // Generate random weights for subcategory and price
    const [w1, w2] = (() => {
        const w1 = 0.6 + Math.random() * 0.2;
        return [w1, 1 - w1];
    })();

    // Score and sort non-purchased products
    const scored = allProducts
        .filter(p => !productIds.includes(p.id))
        .map(p => {
            const scoreSum = purchased.reduce((sum, target) => {
                const sameSub = p.subcategory === target.subcategory ? 1 : 0;
                const priceScore = 1 - Math.abs(p.price - target.price) / maxPriceDiff;
                const similarity = w1 * sameSub + w2 * priceScore;
                return sum + similarity;
            }, 0);

            const avgScore = scoreSum / purchased.length;
            return { ...p, score: avgScore };
        })
        .sort((a, b) => b.score - a.score)
        .slice(0, 3) // Top 3 recommendations
        .map(p => p.id);

    return scored;
}

// --- gRPC Server Setup ---

const server = new grpc.Server();
server.addService(recommendationProto.RecommendationService.service, recommendationService);

// Bind and start the server
server.bindAsync("0.0.0.0:50054", grpc.ServerCredentials.createInsecure(), () => {
    console.log("gRPC Recommendation Server running on port 50054...");
});
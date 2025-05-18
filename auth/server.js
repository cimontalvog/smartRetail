const grpc = require("@grpc/grpc-js"); // gRPC library
const protoLoader = require("@grpc/proto-loader"); // For loading .proto files
const jwt = require('jsonwebtoken'); // For JSON Web Token (JWT) handling
const fs = require('fs'); // Node.js File System module
const bcrypt = require("bcrypt"); // For password hashing

// --- Configuration and Data Loading ---

// Define paths for the Protobuf definition and user data file
const AUTH_PROTO_PATH = "proto/auth.proto";
const USERS_FILE = "data/users.json";

// Initialize users array; load existing users from file if it exists
let users = [];
if (fs.existsSync(USERS_FILE)) {
    users = JSON.parse(fs.readFileSync(USERS_FILE, "utf8"));
}

const SECRET_KEY = "tokensupersecret"; // Secret key for JWT signing

// Load the Protobuf definition for the Auth service
const packageDefinition = protoLoader.loadSync(AUTH_PROTO_PATH);
const authProto = grpc.loadPackageDefinition(packageDefinition).auth;

// --- AuthService Implementation ---

// Implement the RPC methods defined in AuthService
const authService = {
    // Handles user login requests
    Login: (call, callback) => {
        const { username, password } = call.request; // Extract username and password from the request

        // Find the user in the loaded users data
        const user = users.find(u => u.username === username);

        // If user not found, return unsuccessful login
        if (!user) {
            console.log("[AUTH] User " + user + " doesn't exist")
            return callback(null, { success: false, token: '' });
        }

        // Compare the provided password with the stored hashed password
        bcrypt.compare(password, user.password, (err, result) => {
            // If password comparison fails or an error occurs, return unsuccessful login
            if (err || !result) {
                return callback(null, { success: false, token: "" });
            }

            // If passwords match, sign a JWT token and return successful login
            const token = jwt.sign({ username }, SECRET_KEY, { expiresIn: "1h" });
			console.log("[AUTH] User " + user + " logged in")
            callback(null, { success: true, token });
        });
    },

    // Handles new user registration requests
    Register: (call, callback) => {
        const { username, password } = call.request; // Extract username and password from the request

        // Check if username already exists
        if (users.find(u => u.username === username)) {
            return callback(null, {
                success: false,
                message: 'Username already exists'
            });
        }

        // Add new user to the users array and save to file
        users.push({ username, password, cart: [], history: [] }); // Initialize empty cart and history for new user
        fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2)); // Persist users data

        let message = "User " + username + " has registered successfully"

        console.log("[AUTH] " + message);

        // Return successful registration response
        callback(null, {
            success: true,
            message: message
        });
    }
};

// --- gRPC Server Setup and Start ---

// Create a new gRPC server instance
const server = new grpc.Server();

// Add the AuthService implementation to the server
server.addService(authProto.AuthService.service, authService);

// Bind the server to an address and port, and start it
server.bindAsync("0.0.0.0:50051", grpc.ServerCredentials.createInsecure(), (err, port) =>
    {
        // Handle binding errors
        if (err) {
        console.error("[AUTH] Failed to bind gRPC server:", err);
        return;
        }
        // Log successful server startup
        console.log(`[AUTH] gRPC Auth Server running on port ${port}...`);
    }
);
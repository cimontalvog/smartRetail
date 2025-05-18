const grpc = require("@grpc/grpc-js");
const protoLoader = require("@grpc/proto-loader");
const jwt = require('jsonwebtoken');
const path = require('path');
const fs = require('fs');
const bcrypt = require("bcrypt");

// Load .proto file
const PROTO_PATH = "proto/auth.proto";
const USERS_FILE = "data/users.json";

// Read users from the file
let users = [];
if (fs.existsSync(USERS_FILE)) {
	users = JSON.parse(fs.readFileSync(USERS_FILE, "utf8"));
}

const SECRET_KEY = "tokensupersecret"; // Secret used for the JWT token
const packageDefinition = protoLoader.loadSync(PROTO_PATH);

const authProto = grpc.loadPackageDefinition(packageDefinition).auth;

console.log("AUTH!")

// Implement the AuthService
const authService = {
    Login: (call, callback) => {
		console.log(call)
        const { username, password } = call.request;

		const user = users.find(u => u.username === username);

		if (!user) {
			return callback(null, { success: false, token: '' });
		}

		// Compare hashed password
		bcrypt.compare(password, user.password, (err, result) => {
			if (err || !result) {
				return callback(null, { success: false, token: "" });
			}

			const token = jwt.sign({ username }, SECRET_KEY, { expiresIn: "1h" });
			callback(null, { success: true, token });
		});
    },
    Register:(call, callback) => {
        const { username, password } = call.request;

		if (users.find(u => u.username === username)) {
			return callback(null, {
				success: false,
				message: 'Username already exists'
			});
		}

		users.push({ username, password });
		fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));

		callback(null, {
			success: true,
			message: 'User registered successfully'
		});
    }
};

// Start gRPC Server
const server = new grpc.Server();
console.log("AUTH2!")

server.addService(authProto.AuthService.service, authService);

console.log("AUTH3!")

server.bindAsync("0.0.0.0:50051", grpc.ServerCredentials.createInsecure(), (err, port) => {
	if (err) {
	  console.error("Failed to bind gRPC server:", err);
	  return;
	}
	console.log(`gRPC Auth Server running on port ${port}...`);
  });

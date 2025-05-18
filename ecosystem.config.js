module.exports = {
	apps: [
		{ name: "auth", script: "./auth/server.js" },
		{ name: "user", script: "./user/server.js" },
		{ name: "inventory", script: "./inventory/server.js" },
		{ name: "checkout", script: "./checkout/server.js" },
		{ name: "recommendation", script: "./recommendation/server.js" },
		{ name: "frontend", script: "./gui/app.js" }
	]
};
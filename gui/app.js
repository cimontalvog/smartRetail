const express = require('express'); // Imports the Express.js framework to create and manage the web server
const session = require('express-session'); // Imports express-session for managing user sessions (e.g., storing login status)
const bodyParser = require('body-parser'); // Imports body-parser to parse incoming request bodies, specifically URL-encoded data from forms
const path = require('path'); // Imports the built-in 'path' module to handle and transform file paths
const guiRoutes = require('./routes'); // Imports the route definitions from the local 'routes.js' file

const app = express(); // Creates an Express application instance

// --- Middleware Configuration ---

// Configures express-session middleware
app.use(session({
    secret: 'cookiesupersecret', // A secret string used to sign the session ID cookie, preventing tampering
    resave: false, // Prevents the session from being saved back to the session store if it wasn't modified during the request
    saveUninitialized: false, // Prevents uninitialized sessions (new but not modified) from being saved to the store
    cookie: { secure: false } // Sets cookie security
}));

// Configures body-parser middleware.
// `extended: false` means that the URL-encoded data will be parsed with the querystring library.
app.use(bodyParser.urlencoded({ extended: false }));

// Sets EJS as the template engine for rendering dynamic HTML.
app.set('view engine', 'ejs');
// Specifies the directory where EJS template files are located.
app.set('views', path.join(__dirname, 'views'));
// Serves static files (like CSS, JavaScript, images) from the 'styles' directory.
// `express.static` creates a middleware to serve static assets.
app.use(express.static(path.join(__dirname, 'styles')));

// --- Route Handling ---

// Mounts the imported GUI routes. All requests will be routed through `guiRoutes`
app.use('/', guiRoutes);

// --- Server Startup ---

const PORT = 3000; // Defines the port number on which the server will listen.
// Starts the Express server and listens for incoming requests on the specified port.
app.listen(PORT, () => {
    // Logs a message to the console once the server has successfully started.
    console.log(`Frontend GUI running at http://localhost:${PORT}`);
});
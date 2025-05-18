const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const path = require('path');
const guiRoutes = require('./routes');

const app = express();

app.use(session({
	secret: 'cookiesupersecret',
	resave: false,
	saveUninitialized: false,
	cookie: { secure: false }
}));

app.use(bodyParser.urlencoded({ extended: false }));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'styles')));


app.use('/', guiRoutes);

console.log("HEY!");

const PORT = 3000;
app.listen(PORT, () => {
	console.log(`Frontend GUI running at http://localhost:${PORT}`);
});
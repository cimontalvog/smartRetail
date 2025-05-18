const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const guiRoutes = require('./routes');

const app = express();

app.use(bodyParser.urlencoded({ extended: false }));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use('/', guiRoutes);

const PORT = 3000;
app.listen(PORT, () => {
	console.log(`Frontend GUI running at http://localhost:${PORT}`);
});
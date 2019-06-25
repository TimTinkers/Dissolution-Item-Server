// Imports and application setup.
var dotenv = require('dotenv').config()
var express = require('express');
var bodyParser = require('body-parser');
var cookieParser = require('cookie-parser');
var mysql = require('promise-mysql');
var request = require('request-promise');
var jwt = require('jsonwebtoken');
var jwksClient = require('jwks-rsa');
var dissolutionClient = jwksClient({
	jwksUri: 'https://dissolution.auth0.com/.well-known/jwks.json'
});
var app = express();
app.use(express.static('static'));
app.set('view engine', 'ejs');
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({
	extended: true
}));
app.use(cookieParser());

// Middleware for enabling async routes with Express.
const asyncMiddleware = fn => (req, res, next) => {
	Promise.resolve(fn(req, res, next))
	.catch(next);
};

// Constants.
var ADMIN_ACCESS_TOKEN;

// Launch the application and begin the server listening.
app.listen(3000, async function () {
	console.log("Dissolution item exchange server listening on port 3000.");

	// Retrieve administrator credentials.
	var adminUsername = process.env.ADMIN_USERNAME;
	var adminPassword = process.env.ADMIN_PASSWORD;
	const postData = JSON.stringify({
		username : adminUsername,
		password : adminPassword
	});

	var loginResponse = await request({
		method: 'POST',
		uri: 'https://api.dissolution.online/core/master/login/',
		headers: {
			'Accept': 'application/json',
			'Content-Type': 'application/json',
			'Content-Length': postData.length
		},
		body: postData
	});
	loginResponse = JSON.parse(loginResponse);

	ADMIN_ACCESS_TOKEN = loginResponse['access_token'];
});

// A helper function to verify the dissolution access token.
function getKey (header, callback) {
	dissolutionClient.getSigningKey(header.kid, function (error, key) {
		var signingKey = key.publicKey || key.rsaPublicKey;
		callback(null, signingKey);
	});
};

// Validate user login and handle appropriate routing.
app.get('/', function (req, res) {
	var dissolutionToken = req.cookies.dissolutionToken;
	if (dissolutionToken === undefined || dissolutionToken === 'undefined') {
		res.render('login');
	} else {
		jwt.verify(dissolutionToken, getKey, function (error, decoded) {
			if (error) {
				res.render('login');
			} else {
				res.render('dashboard', decoded);
			}
		});
	}
});

// Handle visitors logging in through the web app.
app.post('/login', asyncMiddleware(async (req, res, next) => {
	var username = req.body.username;
	var password = req.body.password;

	const postData = JSON.stringify({
		username : username,
		password : password
	});

	var loginResponse = await request({
		method: 'POST',
		uri: 'https://api.dissolution.online/core/master/login/',
		headers: {
			'Accept': 'application/json',
			'Content-Type': 'application/json',
			'Content-Length': postData.length
		},
		body: postData
	});
	loginResponse = JSON.parse(loginResponse);

	var accessToken = loginResponse['access_token'];
	res.cookie('dissolutionToken', accessToken, { maxAge: 900000, httpOnly: false });
	res.redirect("/");
}));

// Handle visitors logging out.
app.post("/logout", function (req, res) {
	res.clearCookie('dissolutionToken');
	res.redirect('/');
});

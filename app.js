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

// Constant for tracking the administrator's access token.
var ADMIN_ACCESS_TOKEN;

// Launch the application and begin the server listening.
var server = app.listen(3000, async function () {
	console.log('Dissolution item exchange server listening on port 3000.');

	// Retrieve administrator credentials.
	var adminUsername = process.env.ADMIN_USERNAME;
	var adminPassword = process.env.ADMIN_PASSWORD;

	// Verify that the administrator credentials were actually provided.
	if (!adminUsername || !adminPassword) {
		console.error('You must specify administrator credentials in .env!');
		server.close();
		return;
	}

	// Attempt to login with the administrator.
	try {
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

		// Store the administrator's access token for later.
		ADMIN_ACCESS_TOKEN = loginResponse['access_token'];

	// Verify that we were actually able to login.
	} catch (error) {
		console.error('Unable to login as administrator. Check your credentials.');
		server.close();
		return;
	}
});

// A helper function to verify the Dissolution access token.
function getKey (header, callback) {
	dissolutionClient.getSigningKey(header.kid, function (error, key) {
		var signingKey = key.publicKey || key.rsaPublicKey;
		callback(null, signingKey);
	});
};

// Validate user login and handle appropriate routing.
app.get('/', function (req, res) {

	// If the user does not have a valid access cookie, prompt them for login.
	var dissolutionToken = req.cookies.dissolutionToken;
	if (dissolutionToken === undefined || dissolutionToken === 'undefined') {
		res.render('login', { error : 'null' });

	// Otherwise, verify the correctness of the access token.
	} else {
		jwt.verify(dissolutionToken, getKey, function (error, decoded) {
			if (error) {
				res.render('login', {
					error : "\'Your access token cannot be verified. Please log in again.\'"
				});
			} else {
				res.render('dashboard', decoded);
			}
		});
	}
});

// Handle visitors logging in through the web app.
app.post('/login', asyncMiddleware(async (req, res, next) => {

	// Retrieve the username and password from our request body.
	var username = req.body.username;
	var password = req.body.password;

	// Return an appropriate error message if these fields are not provided.
	if (!username || !password) {
		res.render('login', { error : "\'You must provide valid login details.\'" });
		return;
	}

	// Otherwise, attempt to log the user in.
	try {
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

		// If the access token is valid, stash it as a cookie and redirect the user.
		var accessToken = loginResponse['access_token'];
		res.cookie('dissolutionToken', accessToken, { maxAge: 900000, httpOnly: false });
		res.redirect("/");

	// If we were unable to log the user in, notify them.
	} catch (error) {
		res.render('login', { error : "\'Unable to login with that username or password.\'" });
		return;
	}
}));

// Handle visitors logging out by removing the access token.
app.post("/logout", function (req, res) {
	res.clearCookie('dissolutionToken');
	res.redirect('/');
});

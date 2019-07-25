// Imports.
var dotenv = require('dotenv').config();
var express = require('express');
var bodyParser = require('body-parser');
var cookieParser = require('cookie-parser');
var mysql = require('promise-mysql');
var requestPromise = require('request-promise');
var { request, GraphQLClient } = require('graphql-request');
var jwt = require('jsonwebtoken');
var jwksClient = require('jwks-rsa');
var dissolutionClient = jwksClient({
	jwksUri: 'https://dissolution.auth0.com/.well-known/jwks.json'
});

// Express application setup.
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

// Constants for tracking the administrator's access tokens.
var DISSOLUTION_ADMIN_ACCESS_TOKEN;
var ENJIN_ADMIN_ACCESS_TOKEN;
var ENJIN_ADMIN_USER_ID;
var ENJIN_ADMIN_IDENTITY_ID;
var ENJIN_ADMIN_ETHEREUM_ADDRESS;

// Launch the application and begin the server listening.
var server = app.listen(3000, async function () {
	console.log('Starting Dissolution item exchange server listening on port 3000 ...');

	// Retrieve Dissolution administrator credentials.
	var dissolutionAdminUsername = process.env.DISSOLUTION_ADMIN_USERNAME;
	var dissolutionAdminPassword = process.env.DISSOLUTION_ADMIN_PASSWORD;

	// Verify that the administrator credentials were actually provided.
	if (!dissolutionAdminUsername || !dissolutionAdminPassword) {
		console.error('You must specify Dissolution administrator credentials in .env!');
		server.close();
		return;
	}

	// Attempt to log into Dissolution with the administrator.
	try {
		const dissolutionLoginData = JSON.stringify({
			username : dissolutionAdminUsername,
			password : dissolutionAdminPassword
		});
		var dissolutionLoginResponse = await requestPromise({
			method: 'POST',
			uri: 'https://api.dissolution.online/core/master/login/',
			headers: {
				'Accept': 'application/json',
				'Content-Type': 'application/json',
				'Content-Length': dissolutionLoginData.length
			},
			body: dissolutionLoginData
		});
		dissolutionLoginResponse = JSON.parse(dissolutionLoginResponse);

		// Store the Dissolution administrator's access token for later.
		DISSOLUTION_ADMIN_ACCESS_TOKEN = dissolutionLoginResponse['access_token'];

		// Attempt to log into Enjin with the administrator.
		try {

			// Retrieve Enjin administrator credentials.
			var enjinPlatformUrl = process.env.ENJIN_PLATFORM_URL;
			var enjinAdminEmail = process.env.ENJIN_ADMIN_EMAIL;
			var enjinAdminPassword = process.env.ENJIN_ADMIN_PASSWORD;

			// Verify that the administrator credentials were actually provided.
			if (!enjinAdminEmail || !enjinAdminPassword) {
				console.error('You must specify Enjin administrator credentials in .env!');
				server.close();
				return;
			}

			// Issue the login query.
			var client = new GraphQLClient(enjinPlatformUrl, { headers : {} });
			const enjinLoginData = JSON.stringify({
				email : enjinAdminEmail,
				password : enjinAdminPassword
			});
			const enjinLoginQuery =
			`query login($email: String!, $password: String!) {
				request: EnjinOauth(email: $email, password: $password) {
					access_tokens
					id
					identities {
						id
						app_id
						ethereum_address
					}
				}
			}`;
			var enjinLoginResponse = await client.request(enjinLoginQuery, enjinLoginData);
			enjinLoginResponse = enjinLoginResponse.request;

			// Parse out administrator information from the Enjin response.
			ENJIN_ADMIN_ACCESS_TOKEN = enjinLoginResponse['access_tokens'][0]['access_token'];
			ENJIN_ADMIN_USER_ID = enjinLoginResponse.id;
			for (var i = 0; i < enjinLoginResponse.identities.length; i++) {
				var identity = enjinLoginResponse.identities[i];
				var appId = identity['app_id'];
				if (appId === parseInt(process.env.DISSOLUTION_APP_ID)) {
					ENJIN_ADMIN_IDENTITY_ID = identity.id;
					ENJIN_ADMIN_ETHEREUM_ADDRESS = identity['ethereum_address'];
					break;
				}
			}

			// Log our retrieved administrator information.
			console.log('The Dissolution Enjin administrator is available as user ' + ENJIN_ADMIN_USER_ID + ' with identity ' + ENJIN_ADMIN_IDENTITY_ID + ' and address ' + ENJIN_ADMIN_ETHEREUM_ADDRESS);

		// Verify that we were actually able to login.
		} catch (error) {
			console.error(error);
			console.error('Unable to log in as Enjin administrator. Check your credentials.');
			server.close();
			return;
		}

	// Verify that we were actually able to login.
	} catch (error) {
		console.error(error);
		console.error('Unable to log in as Dissolution administrator. Check your credentials.');
		server.close();
		return;
	}

	// Setup completed.
	console.log('... Dissolution item exchange server listening on port 3000.');
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
		var loginResponse = await requestPromise({
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
		res.cookie('dissolutionToken', accessToken, { maxAge: 9000000000, httpOnly: false });
		res.redirect("/");

	// If we were unable to log the user in, notify them.
	} catch (error) {
		console.error(error);
		res.render('login', { error : "\'Unable to login with that username or password.\'" });
		return;
	}
}));

// Handle visitors logging out by removing the access token.
app.post("/logout", function (req, res) {
	res.clearCookie('dissolutionToken');
	res.redirect('/');
});

// A helper function to try to find the user's existing identity and send their inventory to the client.
async function sendStatusToClient(client, email, res) {
	try {
		const enjinSearchData = JSON.stringify({
			email : email
		});
		const enjinSearchMutation =
		`query GetUserByEmail($email: String!) {
			result: EnjinUser(email: $email) {
				id
				name
				identities {
					id
					app_id
					linking_code
					ethereum_address
				}
			}
		}
		`;
		var enjinSearchResponse = await client.request(enjinSearchMutation, enjinSearchData);

		// Find the user's address or linking code for this app.
		var userAddress = "0x0000000000000000000000000000000000000000";
		var userLinkingCode = null;
		var userIdentities = enjinSearchResponse.result.identities;
		for (var i = 0; i < userIdentities.length; i++) {
			var identity = userIdentities[i];
			if (identity['app_id'] === parseInt(process.env.DISSOLUTION_APP_ID)) {
				userAddress = identity['ethereum_address'];
				userLinkingCode = identity['linking_code'];
				break;
			}
		}

		// If the user is linked, send their address and inventory.
		if (userLinkingCode === null || userLinkingCode === "null") {
			try {
				const enjinInventoryData = JSON.stringify({
					address : userAddress
				});
				const enjinInventoryQuery =
				`query getItemBalances($address: String!) {
					result: EnjinIdentities(ethereum_address: $address) {
						tokens(include_creator_tokens: true) {
							token_id
							app_id
							name
							balance
							index
							itemURI
						}
					}
				}`;
				var enjinInventoryResponse = await client.request(enjinInventoryQuery, enjinInventoryData);

				// Process and return the user's inventory to the dashboard.
				var dissolutionInventory = []
				var tokens = enjinInventoryResponse.result[0].tokens;
				for (var i = 0; i < tokens.length; i++) {
					var token = tokens[i];
					if (token['app_id'] === parseInt(process.env.DISSOLUTION_APP_ID)) {
						dissolutionInventory.push(token);
					}
				}
				res.send({ status : 'LINKED', address : userAddress, inventory: dissolutionInventory });

			// Notify the client if we failed to obtain an inventory.
			} catch (error) {
				console.error(error);
				res.send({ status : 'ERROR', message : 'Could not retrieve the user\'s inventory.' });
			}

		// Otherwise, notify the user that they must link.
		} else {
			res.send({ status : 'MUST_LINK', code : userLinkingCode });
		}

	// We could not actually find the user's existing identity.
	} catch (error) {
		console.error(error);
		res.send({ status : 'ERROR', message : 'Could not find the user\'s existing identity.' });
	}
}

// Handle a user requesting to connect to Enjin.
app.post('/connect', asyncMiddleware(async (req, res, next) => {

	// Redirect the user to login if they are not authenticated.
	var dissolutionToken = req.cookies.dissolutionToken;
	if (dissolutionToken === undefined || dissolutionToken === 'undefined') {
		res.render('login', { error : 'null' });

	// Otherwise, verify the correctness of the access token.
	} else {
		jwt.verify(dissolutionToken, getKey, async function (error, decoded) {
			if (error) {
				res.render('login', {
					error : "\'Your access token cannot be verified. Please log in again.\'"
				});

			// If the access token is correct, retrieve the user's email.
			} else {
				try {
					var profileResponse = await requestPromise({
						method: 'GET',
						uri: 'https://api.dissolution.online/core/master/profile/',
						headers: {
							'Accept': 'application/json',
							'Content-Type': 'application/json',
							'Authorization': 'Bearer ' + dissolutionToken
						}
					});
					profileResponse = JSON.parse(profileResponse);

					// Establish our application's client for talking with Enjin.
					var enjinPlatformUrl = process.env.ENJIN_PLATFORM_URL;
					var email = profileResponse.email;
					var client = new GraphQLClient(enjinPlatformUrl, { headers : {
						"Authorization" : 'Bearer ' + ENJIN_ADMIN_ACCESS_TOKEN,
						"X-App-Id" : process.env.DISSOLUTION_APP_ID
					} });

					// Send the user an invitation to Enjin.
					try {
						const enjinInviteData = JSON.stringify({
							email : email
						});
						const enjinInviteMutation =
						`mutation inviteUser($email: String!) {
							UpdateEnjinApp(invite: {
								email: $email
							}) {
								id
							}
						}`;
						var enjinInviteResponse = await client.request(enjinInviteMutation, enjinInviteData);
						await sendStatusToClient(client, email, res);

					// Handle a user who could not be invited because they are already registered to the app.
					} catch (error) {
						if (error.response.errors[0].message === "Bad Request - UpdateEnjinApp : This user already has an identity for this app.") {
							await sendStatusToClient(client, email, res);

						// Otherwise, we've encountered an unknown error and fail.
						} else {
							console.error(error);
							res.send({ status : 'ERROR', message : 'Unknown error occurred when trying to invite the user to Enjin.' });
						}
					}

				// If we are unable to retrieve the user's profile, log an error and notify them.
				} catch (error) {
					console.error(error);
					res.render('login', { error : "\'Unable to retrieve your profile information.\'" });
					return;
				}
			}
		});
	}
}));

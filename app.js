'use strict';

// Retrieve and parse environment variables.
const result = require('dotenv').config();
if (result.error) {
	console.error(result.parsed);
}

// Imports.
const util = require('util');
const express = require('express');
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');
const mysql = require('promise-mysql');
const requestPromise = require('request-promise');
const { GraphQLClient } = require('graphql-request');
const jwt = require('jsonwebtoken');
const jwksClient = require('jwks-rsa');
const gameClient = jwksClient({
	jwksUri: process.env.GAME_JWKS_URI
});
const paypal = require('@paypal/checkout-server-sdk');
const uuidv1 = require('uuid/v1');
const ethers = require('ethers');

// Express application setup.
let app = express();
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

// Track particular state for operating this server.
let APPLICATION = process.env.APPLICATION;
let EXPRESS_PORT = process.env.EXPRESS_PORT;
let GAME_ADMIN_ACCESS_TOKEN;
let ENJIN_ADMIN_ACCESS_TOKEN;
let ENJIN_ADMIN_USER_ID;
let ENJIN_ADMIN_IDENTITY_ID;
let ENJIN_ADMIN_ETHEREUM_ADDRESS;
let PAYPAL_CLIENT;
let DATABASE_CONNECTION;
let PAYMENT_PROCESSOR;

// Launch the application and begin the server listening.
let server = app.listen(EXPRESS_PORT, async function () {
	console.log(util.format(process.env.SETUP_STARTING, APPLICATION, EXPRESS_PORT));

	// Retrieve game server administrator credentials.
	let gameAdminUsername = process.env.GAME_ADMIN_USERNAME;
	let gameAdminPassword = process.env.GAME_ADMIN_PASSWORD;

	// Verify that the game administrator credentials were actually provided.
	if (!gameAdminUsername || !gameAdminPassword) {
		console.error(process.env.INVALID_GAME_ADMIN_CREDENTIALS);
		server.close();
		return;
	}

	// Attempt to log into the game with the administrator.
	try {
		const gameLoginData = JSON.stringify({
			username: gameAdminUsername,
			password: gameAdminPassword
		});
		let gameLoginResponse = await requestPromise({
			method: 'POST',
			uri: process.env.GAME_LOGIN_URI,
			headers: {
				'Accept': 'application/json',
				'Content-Type': 'application/json',
				'Content-Length': gameLoginData.length
			},
			body: gameLoginData
		});
		gameLoginResponse = JSON.parse(gameLoginResponse);

		// Store the game administrator's access token for later.
		GAME_ADMIN_ACCESS_TOKEN = gameLoginResponse['access_token'];

		// Attempt to log into Enjin with the administrator.
		try {
			let enjinPlatformUrl = process.env.ENJIN_PLATFORM_URL;
			let enjinAdminEmail = process.env.ENJIN_ADMIN_EMAIL;
			let enjinAdminPassword = process.env.ENJIN_ADMIN_PASSWORD;

			// Verify that the administrator credentials were actually provided.
			if (!enjinAdminEmail || !enjinAdminPassword) {
				console.error(process.env.INVALID_ENJIN_ADMIN_CREDENTIALS);
				server.close();
				return;
			}

			// Issue the Enjin login query.
			let client = new GraphQLClient(enjinPlatformUrl, { headers: {} });
			const enjinLoginData = JSON.stringify({
				email: enjinAdminEmail,
				password: enjinAdminPassword
			});
			let enjinLoginResponse = await client.request(process.env.ENJIN_LOGIN_QUERY, enjinLoginData);
			enjinLoginResponse = enjinLoginResponse.request;

			// Parse out administrator information from the Enjin response.
			ENJIN_ADMIN_ACCESS_TOKEN = enjinLoginResponse['access_tokens'][0]['access_token'];
			ENJIN_ADMIN_USER_ID = enjinLoginResponse.id;
			for (let i = 0; i < enjinLoginResponse.identities.length; i++) {
				let identity = enjinLoginResponse.identities[i];
				let appId = identity['app_id'];
				if (appId === parseInt(process.env.GAME_APP_ID)) {
					ENJIN_ADMIN_IDENTITY_ID = identity.id;
					ENJIN_ADMIN_ETHEREUM_ADDRESS = identity['ethereum_address'];
					break;
				}
			}

			// Log our retrieved administrator information.
			console.log(util.format(process.env.ENJIN_LOGIN_SUCCESS_MESSAGE, APPLICATION, ENJIN_ADMIN_USER_ID, ENJIN_ADMIN_IDENTITY_ID, ENJIN_ADMIN_ETHEREUM_ADDRESS));

			// Setup PayPal if it is an enabled payment processor.
			if (process.env.PAYPAL_ENABLED) {
				let paypalClientId = process.env.PAYPAL_CLIENT_ID;
				let paypalSecret = process.env.PAYPAL_CLIENT_SECRET;

				// Verify that the PayPal credentials were actually provided.
				if (!paypalClientId || !paypalSecret) {
					console.error(process.env.INVALID_PAYPAL_CREDENTIALS);
					server.close();
					return;
				}

				// Attempt to setup a PayPal client.
				try {
					PAYPAL_CLIENT = new paypal.core.PayPalHttpClient(new paypal.core.SandboxEnvironment(paypalClientId, paypalSecret));

				// Verify that we were actually able to get PayPal access.
				} catch (error) {
					console.error(process.env.PAYPAL_SETUP_ERROR, error);
					server.close();
					return;
				}
			}

			// Attempt to establish connection to the RDS instance.
			try {
				DATABASE_CONNECTION = await mysql.createConnection({
					host: process.env.DATABASE_HOST,
					user: process.env.DATABASE_USER,
					password: process.env.DATABASE_PASSWORD,
					port: process.env.DATABASE_PORT,
					database: process.env.DATABASE,
					timeout: process.env.TIMEOUT
				});

				// Attempt to establish connection to the payment processor contract.
				try {
					let firstPartyPrivateKey = process.env.FIRST_PARTY_PRIVATE_KEY;
					let contractAddress = process.env.PAYMENT_PROCESSOR_ADDRESS;
					let abi = process.env.PAYMENT_PROCESSOR_ABI;
					let provider = ethers.getDefaultProvider(process.env.NETWORK_SUFFIX);
					let wallet = new ethers.Wallet(firstPartyPrivateKey, provider);
					console.log(util.format(process.env.CONNECTING_TO_CONTRACT, contractAddress, process.env.NETWORK_SUFFIX));
					PAYMENT_PROCESSOR = new ethers.Contract(contractAddress, abi, wallet);

				// Catch any errors establishing connection to our payment processor.
				} catch (error) {
					console.error(util.format(process.env.CONTRACT_CONNECTION_ERROR, APPLICATION), error);
					server.close();
					return;
				}

			// Catch any errors when establishing connection to the RDS instance.
			} catch (error) {
				console.error(error);
				DATABASE_CONNECTION.end();
				server.close();
				return;
			}

		// Verify that we were actually able to log into Enjin.
		} catch (error) {
			console.error(process.env.ENJIN_SETUP_ERROR, error);
			server.close();
			return;
		}

	// Verify that we were actually able to log into the game.
	} catch (error) {
		console.error(util.format(process.env.GAME_SETUP_ERROR, APPLICATION), error);
		server.close();
		return;
	}

	// Setup completed.
	console.log(util.format(process.env.SETUP_COMPLETED, APPLICATION, EXPRESS_PORT));
});

// A helper function to verify the game's access token.
function getKey (header, callback) {
	gameClient.getSigningKey(header.kid, function (error, key) {
		if (error) {
			console.error(process.env.SIGNING_KEY_RETRIEVAL_ERROR, error);
		}
		let signingKey = key.publicKey || key.rsaPublicKey;
		callback(null, signingKey);
	});
};

// A helper function to gate particular endpoints behind a valid game login.
function loginValidator (req, res, onValidLogin) {
	let gameToken = req.cookies.gameToken;
	if (gameToken === undefined || gameToken === 'undefined') {
		res.render('login', {
			error: 'null',
			applicationName: APPLICATION
		});

	// Otherwise, verify the correctness of the game's access token.
	} else {
		jwt.verify(gameToken, getKey, function (error, decoded) {
			if (error) {
				res.render('login', {
					error: process.env.GAME_COULD_NOT_LOGIN_ERROR,
					applicationName: APPLICATION
				});
			} else {
				onValidLogin(gameToken, decoded);
			}
		});
	}
};

// TODO: move this function into a dedicated pair of lambda functions.
// TODO: treat ascension like just one more service in this list.
// A helper function to retrieve the set of services that are for sale.
async function getServiceMap (serviceIdFilter) {
	let databaseName = process.env.DATABASE;
	let sql = util.format(process.env.AVAILABLE_SERVICES_QUERY, databaseName, databaseName, databaseName);

	// As an optimization, only check for item sales against a given filter.
	let serviceIdList = '';
	for (let i = 0; i < serviceIdFilter.length; i++) {
		let serviceId = serviceIdFilter[i];
		serviceIdList += (serviceId + ',');
	}
	serviceIdList = serviceIdList.slice(0, -1);
	let values = [ serviceIdList ];

	// Return a map of the items being sold.
	let rows = await DATABASE_CONNECTION.query(sql, values);
	let serviceMap = new Map();
	for (let i = 0; i < rows.length; i++) {
		let row = rows[i];
		serviceMap.set(row.serviceId, row);
	}
	return serviceMap;
};

// Validate whether a user has logged in and handle appropriate routing.
app.get('/', asyncMiddleware(async (req, res, next) => {
	loginValidator(req, res, function (gameToken, decoded) {
		res.render('dashboard', {
			applicationName: APPLICATION,
			gameInventoryUri: process.env.GAME_INVENTORY_URI,
			gameMetadataUri: process.env.GAME_METADATA_URI,
			gameProfileUri: process.env.GAME_PROFILE_URI,
			gameMintScreenUri: process.env.GAME_MINT_SCREEN_URI,
			paypalClientId: process.env.PAYPAL_CLIENT_ID
		});
	});
}));

// Handle visitors logging in through the web app.
app.post('/login', asyncMiddleware(async (req, res, next) => {
	let username = req.body.username;
	let password = req.body.password;

	// Return an appropriate error message if credentials are not provided.
	if (!username || !password) {
		res.render('login', {
			error: process.env.NO_LOGIN_DETAILS,
			applicationName: APPLICATION
		});
		return;
	}

	// Otherwise, attempt to log the user in.
	try {
		const userLoginData = JSON.stringify({
			username: username,
			password: password
		});
		let loginResponse = await requestPromise({
			method: 'POST',
			uri: process.env.GAME_LOGIN_URI,
			headers: {
				'Accept': 'application/json',
				'Content-Type': 'application/json',
				'Content-Length': userLoginData.length
			},
			body: userLoginData
		});
		loginResponse = JSON.parse(loginResponse);

		// If the access token is valid, stash it as a cookie and redirect the user.
		let accessToken = loginResponse['access_token'];
		res.cookie('gameToken', accessToken, { maxAge: 9000000000, httpOnly: false });
		res.redirect('/');

	// If we were unable to log the user in, notify them.
	} catch (error) {
		console.error(process.env.USER_UNABLE_TO_LOGIN, error);
		res.render('login', {
			error: process.env.USER_UNABLE_TO_LOGIN,
			applicationName: APPLICATION
		});
	}
}));

// Handle visitors logging out by removing their access token.
app.post('/logout', function (req, res) {
	res.clearCookie('gameToken');
	res.redirect('/');
});

// A helper function to try to find the user's existing identity and send their inventory to the client.
async function sendStatusToClient (client, email, userId, res) {
	try {
		const enjinSearchData = JSON.stringify({
			appId: process.env.GAME_APP_ID
		});
		let enjinSearchResponse = await client.request(process.env.ENJIN_SEARCH_MUTATION, enjinSearchData);

		// Find the user's address or linking code for this app.
		let userAddress = '0x0000000000000000000000000000000000000000';
		let userLinkingCode = null;
		let userLinkingCodeQR = '';
		let userIdentities = enjinSearchResponse.result.identities;
		for (let i = 0; i < userIdentities.length; i++) {
			let identity = userIdentities[i];
			if (identity.user['email'] === email) {
				userAddress = identity['ethereum_address'];
				userLinkingCode = identity['linking_code'];
				userLinkingCodeQR = identity['linking_code_qr'];
				break;
			}
		}

		// If the user is linked, send their address and inventory.
		if (userLinkingCode === null || userLinkingCode === 'null') {
			try {
				const enjinInventoryData = JSON.stringify({
					address: userAddress
				});
				let enjinInventoryResponse = await client.request(process.env.ENJIN_INVENTORY_QUERY, enjinInventoryData);

				// Update the last address recorded for this user.
				let databaseName = process.env.DATABASE;
				let sql = util.format(process.env.UPDATE_LAST_ADDRESS, databaseName);
				let values = [ userAddress, userId ];
				await DATABASE_CONNECTION.query(sql, values);

				// Retrieve all Enjin items with in-game equivalents.
				let validEnjinIds = new Set();
				sql = util.format(process.env.GET_VALID_ENJIN_ITEMS, databaseName, process.env.NETWORK_SUFFIX);
				let validEnjinItems = await DATABASE_CONNECTION.query(sql);
				for (let i = 0; i < validEnjinItems.length; i++) {
					let validEnjinItemId = validEnjinItems[i].enjinId;
					validEnjinIds.add(validEnjinItemId);
				}

				// Process and return the user's inventory to the dashboard.
				let gameInventory = [];
				let tokens = enjinInventoryResponse.result[0].tokens;
				for (let i = 0; i < tokens.length; i++) {
					let token = tokens[i];
					if (token['app_id'] === parseInt(process.env.GAME_APP_ID) && validEnjinIds.has(token['token_id'])) {
						gameInventory.push(token);
					}
				}
				res.send({ status: 'LINKED', address: userAddress, inventory: gameInventory });

			// Notify the client if we failed to obtain an inventory.
			} catch (error) {
				console.error(process.env.INVENTORY_RETRIEVAL_FAILED, error);
				res.send({ status: 'ERROR', message: process.env.INVENTORY_RETRIEVAL_FAILED });
			}

		// Otherwise, notify the user that they must link.
		} else {
			res.send({ status: 'MUST_LINK', code: userLinkingCode, qr: userLinkingCodeQR });
		}

	// We could not actually find the user's existing identity.
	} catch (error) {
		console.error(process.env.EXISTING_ENJIN_IDENTITY_FAILED, error);
		res.send({ status: 'ERROR', message: process.env.EXISTING_ENJIN_IDENTITY_FAILED });
	}
};

// Handle a user requesting to connect to Enjin.
app.post('/connect', asyncMiddleware(async (req, res, next) => {
	loginValidator(req, res, async function (gameToken, decoded) {
		try {
			let profileResponse = await requestPromise({
				method: 'GET',
				uri: process.env.GAME_PROFILE_URI,
				headers: {
					'Accept': 'application/json',
					'Content-Type': 'application/json',
					'Authorization': 'Bearer ' + gameToken
				}
			});
			profileResponse = JSON.parse(profileResponse);
			let userId = profileResponse.userId;

			// Establish our application's client for talking with Enjin.
			let enjinPlatformUrl = process.env.ENJIN_PLATFORM_URL;
			let email = profileResponse.email;
			let client = new GraphQLClient(enjinPlatformUrl, {
				headers: {
					'Authorization': 'Bearer ' + ENJIN_ADMIN_ACCESS_TOKEN,
					'X-App-Id': process.env.GAME_APP_ID
				}
			});

			// Send the user an invitation to Enjin.
			try {
				const enjinInviteData = JSON.stringify({
					email: email
				});
				await client.request(process.env.ENJIN_INVITE_MUTATION, enjinInviteData);
				await sendStatusToClient(client, email, userId, res);

			// Handle a user who could not be invited because they are already registered to the app.
			} catch (error) {
				if (error.response.errors[0].message === process.env.ENJIN_ALREADY_INVITED_ERROR) {
					await sendStatusToClient(client, email, userId, res);

				// Otherwise, we've encountered an unknown error and fail.
				} else {
					console.error(process.env.UNKNOWN_ERROR, error);
					res.send({ status: 'ERROR', message: process.env.UNKNOWN_ERROR });
					return;
				}
			}

		// If we are unable to retrieve the user's profile, log an error and notify them.
		} catch (error) {
			console.error(process.env.GAME_UNABLE_TO_RETRIEVE_PROFILE, error);
			res.render('login', {
				error: process.env.GAME_UNABLE_TO_RETRIEVE_PROFILE,
				applicationName: APPLICATION
			});
		}
	});
}));

// Screen items in a user's inventory to make sure they may be ascended.
app.post('/screen-items', asyncMiddleware(async (req, res, next) => {
	loginValidator(req, res, async function (gameToken, decoded) {
		try {
			let unscreenedItems = req.body.unscreenedItems;
			let databaseName = process.env.DATABASE;

			// Retrieve all Enjin items with in-game equivalents.
			let validGameIds = new Set();
			let sql = util.format(process.env.GET_VALID_GAME_ITEMS, databaseName, process.env.NETWORK_SUFFIX);
			let validGameItems = await DATABASE_CONNECTION.query(sql);
			for (let i = 0; i < validGameItems.length; i++) {
				let validGameItemId = validGameItems[i].itemId;
				validGameIds.add(validGameItemId);
			}

			// Filter items that require screening.
			let screenedItems = [];
			for (let i = 0; i < unscreenedItems.length; i++) {
				let unscreenedItem = unscreenedItems[i];
				if (validGameIds.has(parseInt(unscreenedItem.id))) {
					screenedItems.push(unscreenedItem);
				}
			}

			// Return the screened inventory items.
			res.send({ status: 'SCREENED', screenedItems: screenedItems });

		// If we are unable to screen a user's items, log an error and notify them.
		} catch (error) {
			console.error(process.env.GAME_UNABLE_TO_SCREEN_INVENTORY, error);
			res.send({ status: 'ERROR', message: process.env.GAME_UNABLE_TO_SCREEN_INVENTORY });
		}
	});
}));

// Handle a user requesting to complete a purchase.
app.post('/checkout', asyncMiddleware(async (req, res, next) => {
	loginValidator(req, res, async function (gameToken, decoded) {
		try {
			let profileResponse = await requestPromise({
				method: 'GET',
				uri: process.env.GAME_PROFILE_URI,
				headers: {
					'Accept': 'application/json',
					'Content-Type': 'application/json',
					'Authorization': 'Bearer ' + gameToken
				}
			});
			profileResponse = JSON.parse(profileResponse);
			let userId = profileResponse.userId;
			let requestedServices = req.body.requestedServices;

			// Retrieve the services that are available for sale.
			let serviceIdFilter = [];
			for (let i = 0; i < requestedServices.length; i++) {
				let service = requestedServices[i];
				let serviceId = service.id;
				if (serviceId !== 'ASCENSION') {
					serviceIdFilter.push(serviceId);
				}
			};
			let availableServices = await getServiceMap(serviceIdFilter);

			// Calculate the cost for the services that a user is requesting to buy.
			let totalCost = 0;
			let ascensionReadyItems = new Map();
			let confirmedToPurchaseItems = [];
			for (let i = 0; i < requestedServices.length; i++) {
				let service = requestedServices[i];
				let serviceId = service.id;
				let requestedAmount = service.amount;

				// Ascension is a fairly-complicated service that uses its own supply options so we handle that separately.
				if (serviceId === 'ASCENSION') {
					if (!process.env.ASCENSION_ENABLED) {
						res.send({ status: 'ERROR', message: process.env.ASCENSION_DISABLED_ERROR });
						return;
					}
					let checkoutItems = service.checkoutItems;

					// Try to retrieve the user's inventory.
					try {
						let inventoryResponse = await requestPromise({
							method: 'GET',
							uri: process.env.GAME_INVENTORY_URI,
							headers: {
								'Accept': 'application/json',
								'Content-Type': 'application/json',
								'Authorization': 'Bearer ' + gameToken
							}
						});
						inventoryResponse = JSON.parse(inventoryResponse);
						let inventory = inventoryResponse.inventory;

						// Create an accessible cache of inventory data.
						let inventoryMap = {};
						for (let i = 0; i < inventory.length; i++) {
							let item = inventory[i];
							if (item.amount > 0) {
								inventoryMap[item.itemId] = item.amount;
							}
						}

						// Retrieve the user's list of items to ascend.
						let clearToCheckout = true;
						let itemCount = 0;
						let itemsToMint = new Map();
						if (checkoutItems) {
							for (let itemId in checkoutItems) {
								let requestedAmount = checkoutItems[itemId];
								if (requestedAmount <= 0) {
									continue;
								}

								// Validate that the user owns the items they wish to ascend.
								let availableAmount = inventoryMap[itemId];
								if (availableAmount < requestedAmount) {
									clearToCheckout = false;
								} else {
									itemCount += 1;
									itemsToMint.set(itemId, requestedAmount);
								}
							}

							// Throw an error if the user has not chosen to checkout at least one item.
							if (itemCount < 1) {
								res.send({ status: 'ERROR', message: process.env.EMPTY_ASCENSION_ERROR });
								return;
							}

							// If the user is not clear to checkout, they might not have the items to cover the transaction.
							if (!clearToCheckout) {
								res.send({ status: 'ERROR', message: process.env.ITEMS_NOT_OWNED_ERROR });
								return;
							}

							// All hurdles have been passed for this ascension attempt.
							totalCost += (itemCount * process.env.ASCENSION_COST);
							ascensionReadyItems = itemsToMint;

						// Return an error regarding an empty set of checkout items.
						} else {
							res.send({ status: 'ERROR', message: process.env.NO_ASCENSION_ITEMS_CHOSEN });
							return;
						}

					// If we are unable to retrieve the user's inventory, log an error and notify them.
					} catch (error) {
						console.error(process.env.GAME_UNABLE_TO_RETRIEVE_INVENTORY, error);
						res.send({ status: 'ERROR', message: process.env.GAME_UNABLE_TO_RETRIEVE_INVENTORY });
						return;
					}

				// Check for the availability of particular services.
				} else if (availableServices.has(serviceId)) {
					let serviceInformation = availableServices.get(serviceId);
					let itemAmount = serviceInformation.amount;
					let availableItemAmount = serviceInformation.availableForSale;

					// If the service is for sale, make sure it is still in supply.
					if (itemAmount < availableItemAmount) {
						res.send({ status: 'ERROR', message: process.env.OUT_OF_STOCK });
						return;
					}

					// Add this validated service purchase to the total order.
					let servicePrice = serviceInformation.price;
					totalCost += (servicePrice * requestedAmount);
					confirmedToPurchaseItems.push({
						serviceInformation: serviceInformation,
						purchasedAmount: requestedAmount
					});

				// This service is unknown.
				} else {
					res.send({ status: 'ERROR', message: process.env.UNKNOWN_SERVICE_REQUESTED });
					return;
				}
			}

			// Retrieve the user's chosen payment method.
			let paypalEnabled = process.env.PAYPAL_ENABLED;
			let paymentMethod = req.body.paymentMethod;

			// If Paypal is not enabled, notify the user as such.
			if (paymentMethod === 'PAYPAL') {
				if (!paypalEnabled) {
					res.send({ status: 'ERROR', message: process.env.PAYPAL_DISABLED_ERROR });
					return;
				}

				// Prepare a list of all purchased services to provide to PayPal.
				let purchasedItemsList = [];
				for (let i = 0; i < confirmedToPurchaseItems.length; i++) {
					let service = confirmedToPurchaseItems[i];
					let serviceInformation = service.serviceInformation;
					let purchasedAmount = service.purchasedAmount;
					let metadata = JSON.parse(serviceInformation.metadata);
					let itemName = metadata.name;
					let itemDescription = metadata.description;
					let itemPrice = serviceInformation.price;
					let itemAmount = serviceInformation.amount;
					purchasedItemsList.push({
						name: (itemAmount + ' x ' + itemName),
						description: itemDescription.substring(0, 127),
						unit_amount: {
							currency_code: 'USD',
							value: (itemPrice * 1.00)
						},
						quantity: purchasedAmount,
						category: 'DIGITAL_GOODS'
					});
				}

				// Add an item to the list for tracking ascension, if present.
				if (ascensionReadyItems.size > 0) {
					purchasedItemsList.push({
						name: (ascensionReadyItems.size + ' x Ascension'),
						description: process.env.ASCENSION_DESCRIPTION.substring(0, 127),
						unit_amount: {
							currency_code: 'USD',
							value: (process.env.ASCENSION_COST * 1.00)
						},
						quantity: ascensionReadyItems.size,
						category: 'DIGITAL_GOODS'
					});
				}

				// Charge the user for the items; call PayPal to set up a transaction.
				let referenceOrderId = uuidv1();
				const request = new paypal.orders.OrdersCreateRequest();
				request.prefer('return=representation');
				let paypalRequestBody = {
					intent: 'CAPTURE',
					application_context: {
						brand_name: process.env.APPLICATION
					},
					purchase_units: [{
						reference_id: referenceOrderId,
						description: process.env.PAYPAL_PURCHASE_DESCRIPTION,
						amount: {
							currency_code: 'USD',
							value: (totalCost * 1.00),
							breakdown: {
								item_total: {
									currency_code: 'USD',
									value: (totalCost * 1.00)
								}
							}
						},
						items: purchasedItemsList
					}]
				};
				request.requestBody(paypalRequestBody);

				// Try to request that this order be fulfilled using PayPal.
				let order;
				try {
					order = await PAYPAL_CLIENT.execute(request);
				} catch (error) {
					console.error(process.env.PAYPAL_ORDER_CREATION_ERROR, error);
					return res.sendStatus(500);
				}

				// TODO: lock the items in escrow while payment pends.
				// Format and store the order history to deliver upon later payment.
				let serializableAscensionMap = {};
				for (let itemId of ascensionReadyItems.keys()) {
					serializableAscensionMap[itemId] = ascensionReadyItems.get(itemId);
				}
				let gamePurchaseDetails = { purchasedItems: confirmedToPurchaseItems, ascendingItems: serializableAscensionMap };
				paypalRequestBody.gamePurchaseDetails = gamePurchaseDetails;

				// Create an entry in our database for this order.
				let databaseName = process.env.DATABASE;
				let sql = util.format(process.env.INSERT_ORDER_DETAILS, databaseName);
				let values = [ referenceOrderId, userId, totalCost, 'PAYPAL', JSON.stringify(paypalRequestBody) ];
				await DATABASE_CONNECTION.query(sql, values);

				// Create an entry to flag this order as pending.
				sql = util.format(process.env.INSERT_ORDER_STATUS, databaseName);
				values = [ referenceOrderId, 0, JSON.stringify(gamePurchaseDetails) ];
				await DATABASE_CONNECTION.query(sql, values);

				// Return a successful response to the client with the order ID.
				res.send({
					orderID: order.result.id
				});

			// If the user has chosen to pay with Ether, generate a transaction.
			} else if (paymentMethod === 'ETHER') {
				let serializableAscensionMap = {};

				// TODO: lock the items in escrow while payment pends.
				// Format and store the order history to deliver upon later payment.
				for (let itemId of ascensionReadyItems.keys()) {
					serializableAscensionMap[itemId] = ascensionReadyItems.get(itemId);
				}
				let purchaser = req.body.purchaser;
				let gamePurchaseDetails = { purchasedItems: confirmedToPurchaseItems, ascendingItems: serializableAscensionMap, purchaser: purchaser };

				// Create an entry in our database for this order.
				let referenceOrderId = uuidv1();
				let databaseName = process.env.DATABASE;
				let sql = util.format(process.env.INSERT_ORDER_DETAILS, databaseName);
				let values = [ referenceOrderId, userId, totalCost, 'ETHER', JSON.stringify(gamePurchaseDetails) ];
				await DATABASE_CONNECTION.query(sql, values);

				// Create an entry to flag this order as pending.
				sql = util.format(process.env.INSERT_ORDER_STATUS, databaseName);
				values = [ referenceOrderId, 0, JSON.stringify(gamePurchaseDetails) ];
				await DATABASE_CONNECTION.query(sql, values);

				// TODO: actually create and sign multiple services; for now only ascension is operable.
				// TODO: track a mapping of store service to payment process services.
				// Return a series of transactions for all requested purchases.
				let purchaseData = Object.values({
					serviceId: 0,
					orderId: referenceOrderId
				});
				let transactionData = PAYMENT_PROCESSOR.interface.functions['purchase'].encode(purchaseData);
				res.send({
					nonce: 0,
					gasLimit: 3000000,
					to: process.env.PAYMENT_PROCESSOR_ADDRESS,
					data: transactionData,
					value: (5500000000000000 * ascensionReadyItems.size)
				});

			// If the user has chosen an unknown payment option, notify them.
			} else {
				res.send({ status: 'ERROR', message: process.env.UNKNOWN_PAYMENT_PROCESSOR });
				return;
			}

		// If we are unable to retrieve the user's profile, log an error and notify them.
		} catch (error) {
			console.error(process.env.GAME_UNABLE_TO_RETRIEVE_PROFILE, error);
			res.render('login', {
				error: process.env.GAME_UNABLE_TO_RETRIEVE_PROFILE,
				applicationName: APPLICATION
			});
		}
	});
}));

// Handle a user approving a PayPal transaction.
app.post('/approve', asyncMiddleware(async (req, res, next) => {
	let paypalEnabled = process.env.PAYPAL_ENABLED;
	if (!paypalEnabled) {
		res.sendStatus(400);
		return;
	}
	const orderId = req.body.orderID;

	// Try to capture the PayPal order and log the status in our database.
	const request = new paypal.orders.OrdersCaptureRequest(orderId);
	request.requestBody({});
	try {
		const capture = await PAYPAL_CLIENT.execute(request);
		let orderId = capture.result['purchase_units'][0]['reference_id'];

		// Retrieve the cost of a prior order.
		let databaseName = process.env.DATABASE;
		let sql = util.format(process.env.GET_ORDER_DETAILS, databaseName);
		let values = [ orderId ];
		let rows = await DATABASE_CONNECTION.query(sql, values);
		let cost = rows[0].cost;
		let orderDetails = JSON.parse(rows[0].details);
		let userId = rows[0].userId;

		// Verify that the captured transaction is correctly-priced.
		let transactionStatus = capture.result['purchase_units'][0].payments.captures[0].status;
		let transactionCurrency = capture.result['purchase_units'][0].payments.captures[0].amount['currency_code'];
		let transactionValue = capture.result['purchase_units'][0].payments.captures[0].amount.value;
		if (transactionStatus === 'COMPLETED' && transactionCurrency === 'USD' && parseFloat(transactionValue) >= cost) {
			let gamePurchaseDetails = orderDetails.gamePurchaseDetails;
			let purchasedItems = gamePurchaseDetails.purchasedItems;
			let ascendingItems = gamePurchaseDetails.ascendingItems;

			// TODO: this process should operate directly against the database.
			// The transaction succeeded! Remove the database-backed unascended items.
			for (let itemId in ascendingItems) {
				if (ascendingItems.hasOwnProperty(itemId)) {
					let amount = ascendingItems[itemId];

					const gameRemoveItemData = JSON.stringify({
						itemId: itemId,
						amount: amount,
						recipientId: userId
					});
					await requestPromise({
						method: 'POST',
						uri: process.env.GAME_REMOVE_ITEM_URI,
						headers: {
							'Accept': 'application/json',
							'Content-Type': 'application/json',
							'Content-Length': gameRemoveItemData.length,
							'Authorization': 'Bearer ' + GAME_ADMIN_ACCESS_TOKEN
						},
						body: gameRemoveItemData
					});
				}
			}

			// Mint the newly-purchased items to the user's wallet.
			for (let i = 0; i < purchasedItems.length; i++) {
				let service = purchasedItems[i];
				let serviceInformation = service.serviceInformation;
				let itemId = serviceInformation.itemId;
				let itemAmount = serviceInformation.amount;
				let purchasedAmount = service.purchasedAmount;
				let amountToMint = (itemAmount * purchasedAmount);

				// Get the user's address and verify it is not the zero address.
				sql = util.format(process.env.GET_LAST_ADDRESS, databaseName);
				values = [ userId ];
				rows = await DATABASE_CONNECTION.query(sql, values);
				let userAddress = rows[0].lastAddress;
				if (userAddress === '0x0000000000000000000000000000000000000000') {
					res.sendStatus(400);
					return;

				// Retrieve the Enjin token identifier corresponding to this item.
				} else {
					sql = util.format(process.env.GET_ENJIN_ITEM_ID, databaseName, process.env.NETWORK_SUFFIX);
					values = [ itemId ];
					rows = await DATABASE_CONNECTION.query(sql, values);
					let enjinTokenId = rows[0].enjinId;

					// Issue a transaction to mint the user's purchase on Enjin.
					let enjinPlatformUrl = process.env.ENJIN_PLATFORM_URL;
					let client = new GraphQLClient(enjinPlatformUrl, {
						headers: {
							'Authorization': 'Bearer ' + ENJIN_ADMIN_ACCESS_TOKEN,
							'X-App-Id': process.env.GAME_APP_ID
						}
					});
					const enjinMintData = JSON.stringify({
						id: process.env.GAME_APP_ID,
						tokenId: enjinTokenId,
						address: userAddress,
						amount: amountToMint
					});
					await client.request(process.env.ENJIN_MINT_MUTATION, enjinMintData);
				}
			}

			// Mint the freshly-ascended items to the user's wallet.
			for (let itemId in ascendingItems) {
				if (ascendingItems.hasOwnProperty(itemId)) {
					let amount = ascendingItems[itemId];

					// Get the user's address and verify it is not the zero address.
					sql = util.format(process.env.GET_LAST_ADDRESS, databaseName);
					values = [ userId ];
					rows = await DATABASE_CONNECTION.query(sql, values);
					let userAddress = rows[0].lastAddress;
					if (userAddress === '0x0000000000000000000000000000000000000000') {
						res.sendStatus(400);
						return;

					// Retrieve the Enjin token identifier corresponding to this item.
					} else {
						sql = util.format(process.env.GET_ENJIN_ITEM_ID, databaseName, process.env.NETWORK_SUFFIX);
						values = [ itemId ];
						rows = await DATABASE_CONNECTION.query(sql, values);
						let enjinTokenId = rows[0].enjinId;

						// Issue a transaction to mint the user's purchase on Enjin.
						let enjinPlatformUrl = process.env.ENJIN_PLATFORM_URL;
						let client = new GraphQLClient(enjinPlatformUrl, {
							headers: {
								'Authorization': 'Bearer ' + ENJIN_ADMIN_ACCESS_TOKEN,
								'X-App-Id': process.env.GAME_APP_ID
							}
						});
						const enjinMintData = JSON.stringify({
							id: process.env.GAME_APP_ID,
							tokenId: enjinTokenId,
							address: userAddress,
							amount: amount
						});
						await client.request(process.env.ENJIN_MINT_MUTATION, enjinMintData);
					}
				}
			}

			// Record the transaction as a success.
			sql = util.format(process.env.INSERT_ORDER_STATUS, databaseName);
			values = [ orderId, 1, JSON.stringify(capture) ];
			await DATABASE_CONNECTION.query(sql, values);

			// Let the user know that everything worked.
			res.sendStatus(200);

		// Record this transaction as having failed.
		} else {
			console.error(process.env.PAYPAL_ORDER_VERIFICATION_FAILED);
			sql = util.format(process.env.INSERT_ORDER_STATUS, databaseName);
			values = [ orderId, 2, JSON.stringify(capture) ];
			await DATABASE_CONNECTION.query(sql, values);
			res.sendStatus(400);
		}

	// Throw an error if we were unable to capture the PayPal order.
	}	catch (error) {
		console.error(process.env.PAYPAL_CAPTURE_ERROR, error);
		res.sendStatus(500);
	}
}));

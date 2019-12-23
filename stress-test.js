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
const tough = require('tough-cookie');
const each = require('async-each');

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

// Attempt the same initialization as the real application.
async function attemptApplicationSetup () {
	try {
		console.log(util.format(process.env.SETUP_STARTING, APPLICATION, EXPRESS_PORT));

		// Retrieve game server administrator credentials.
		let gameAdminUsername = process.env.GAME_ADMIN_USERNAME;
		let gameAdminPassword = process.env.GAME_ADMIN_PASSWORD;

		// Verify that the game administrator credentials were actually provided.
		if (!gameAdminUsername || !gameAdminPassword) {
			console.error(process.env.INVALID_GAME_ADMIN_CREDENTIALS);
			process.exit();
		}

		// Verify that payment methods for checkout were actually provided.
		if (process.env.CHECKOUT_ENABLED === 'true') {
			if (process.env.PAYPAL_ENABLED === 'false' &&
			process.env.ETHER_ENABLED === 'false') {
				console.error(process.env.NO_PAYMENT_METHOD_AVAILABLE);
				process.exit();
			}
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
					process.exit();
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
				if (process.env.PAYPAL_ENABLED === 'true') {
					let paypalClientId = process.env.PAYPAL_CLIENT_ID;
					let paypalSecret = process.env.PAYPAL_CLIENT_SECRET;

					// Verify that the PayPal credentials were actually provided.
					if (!paypalClientId || !paypalSecret) {
						console.error(process.env.INVALID_PAYPAL_CREDENTIALS);
						process.exit();
					}

					// Attempt to setup a PayPal client.
					try {
						PAYPAL_CLIENT = new paypal.core.PayPalHttpClient(new paypal.core.SandboxEnvironment(paypalClientId, paypalSecret));

					// Verify that we were actually able to get PayPal access.
					} catch (error) {
						console.error(process.env.PAYPAL_SETUP_ERROR, error);
						process.exit();
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
						process.exit();
					}

				// Catch any errors when establishing connection to the RDS instance.
				} catch (error) {
					console.error(error);
					DATABASE_CONNECTION.end();
					process.exit();
				}

			// Verify that we were actually able to log into Enjin.
			} catch (error) {
				console.error(process.env.ENJIN_SETUP_ERROR, error);
				process.exit();
			}

			// Verify that we were actually able to log into the game.
		} catch (error) {
			console.error(util.format(process.env.GAME_SETUP_ERROR, APPLICATION), error);
			process.exit();
		}

		// Setup completed.
		console.log(util.format(process.env.SETUP_COMPLETED, APPLICATION, EXPRESS_PORT));
	} catch (error) {
		console.error(error);
	}
};

// Prepares all services being requested by a user for purchase.
function buildRequestList (ascensionItems, checkoutItems) {
	let order = [];

	// Check if the user is requesting to ascend any items.
	let hasAscension = false;
	let filteredAscensionItems = {};
	for (let itemId in ascensionItems) {
		let requestedAmount = ascensionItems[itemId];
		if (requestedAmount <= 0) {
			continue;
		} else {
			hasAscension = true;
			filteredAscensionItems[itemId] = requestedAmount;
			console.log(itemId, requestedAmount, filteredAscensionItems);
		}
	}

	// If so, then note that ascension is happening in the order.
	if (hasAscension) {
		order.push({
			id: 'ASCENSION',
			checkoutItems: filteredAscensionItems
		});
	}

	// Check if the user has requested to buy any services.
	for (let serviceId in checkoutItems) {
		let requestedAmount = checkoutItems[serviceId];
		if (requestedAmount <= 0) {
			continue;
		} else {
			order.push({
				id: serviceId,
				amount: requestedAmount
			});
		}
	}
	return order;
};

// Attempt to stress test a particular endpoint.
async function testEndpoint (iterations, options, name, carts, bodyFunction) {
	options.resolveWithFullResponse = true;
	options.time = true;
	let totalResponseTime = 0;
	let originalCookie = '';
	if (options.headers && options.headers['Cookie']) {
		originalCookie = options.headers['Cookie'];
	}
	let failureCount = 0;

	// Create an array of iteration data.
	let iterationPromises = [];
	for (let i = 0; i < iterations; i++) {
		if (carts) {
			let cart = carts[i];
			options.headers['Cookie'] = `${originalCookie};shoppingCart=${JSON.stringify(cart)}`;
			if (bodyFunction) {
				options.body = bodyFunction(cart);
			}
		}
		iterationPromises.push(requestPromise(options));
	}

	// Asynchronously execute all iterated requests.
	for (let i = 0; i < iterations; i++) {
		let iterationPromise = iterationPromises[i];
		try {
			let response = await iterationPromise;
			totalResponseTime += response.elapsedTime;
		} catch (error) {
			failureCount++;
		}
	}

	// Display the result of this test case.
	let percent = (100.0 * ((1.0 * (iterations - failureCount)) / iterations)).toFixed(1);
	let averageResponseTime = (totalResponseTime / iterations).toFixed(0);
	console.log(`... tested ${name}, success rate ${percent}%. Average response time: ${averageResponseTime}ms.`);
};

// Replicate application launch and conduct stress testing.
(async () => {
	await attemptApplicationSetup();

	// Retrieve the base testing URI to use.
	if (!process.argv[2]) {
		console.error('You must specify a URI to test against; node stress-test <URI> [iterations].');
		process.exit();
	}
	let testingUri = process.argv[2];

	// Retrieve the number of testing iterations; default to 10.
	let iterations = 10;
	if (process.argv[3]) {
		iterations = parseInt(process.argv[3]);
	}

	// Proceed to stress test the login landing page.
	await testEndpoint(iterations, {
		uri: testingUri
	}, 'login landing page');

	// Proceed to stress test the primary store page.
	await testEndpoint(iterations, {
		uri: testingUri,
		headers: {
			'Cookie': `gameToken=${GAME_ADMIN_ACCESS_TOKEN}`
		}
	}, 'empty store page');

	// Create randomized carts.
	let carts = [];
	for (let i = 0; i < iterations; i++) {
		let cart = {};
		let itemCount = Math.floor(Math.random() * (51));
		for (let j = 0; j < itemCount; j++) {
			let serviceId = Math.floor(Math.random() * (51));
			let serviceCount = Math.floor(Math.random() * (5));
			cart[serviceId] = serviceCount;
		}
		carts[i] = cart;
	}

	// Proceed to stress test the primary store page with randomized carts.
	await testEndpoint(iterations, {
		uri: testingUri,
		headers: {
			'Cookie': `gameToken=${GAME_ADMIN_ACCESS_TOKEN}`
		}
	}, 'store page with random carts', carts);

	// Proceed to stress test the primary connection endpoint.
	await testEndpoint(iterations, {
		uri: `${testingUri}/connect`,
		method: 'POST',
		headers: {
			'Cookie': `gameToken=${GAME_ADMIN_ACCESS_TOKEN}`
		}
	}, 'enjin connection attempt', carts);

	// Proceed to stress test the sales endpoint.
	await testEndpoint(iterations, {
		uri: `${testingUri}/sales`,
		method: 'POST',
		headers: {
			'Cookie': `gameToken=${GAME_ADMIN_ACCESS_TOKEN}`
		}
	}, 'retrieving sales');

	// Proceed to stress test the discount retrieval endpoint.
	await testEndpoint(iterations, {
		uri: `${testingUri}/get-discount`,
		method: 'POST',
		headers: {
			'Cookie': `gameToken=${GAME_ADMIN_ACCESS_TOKEN}`
		},
		body: {
			address: ENJIN_ADMIN_ETHEREUM_ADDRESS
		},
		json: true
	}, 'retrieving discount value');

	// Create randomized, valid, test-item carts.
	let testingCarts = [];
	for (let i = 0; i < iterations; i++) {
		let cart = {};
		cart['5'] = Math.floor(Math.random() * (3));
		cart['6'] = Math.floor(Math.random() * (3));
		testingCarts[i] = cart;
	}

	// Proceed to stress test the PayPal checkout endpoint.
	await testEndpoint(iterations, {
		uri: `${testingUri}/checkout`,
		method: 'POST',
		headers: {
			'Cookie': `gameToken=${GAME_ADMIN_ACCESS_TOKEN}`
		},
		json: true
	}, 'checking out with PayPal', testingCarts, function (cart) {
		return {
			requestedServices: buildRequestList({}, cart),
			paymentMethod: 'PAYPAL'
		};
	});

	// Proceed to stress test the Ether checkout endpoint.
	await testEndpoint(iterations, {
		uri: `${testingUri}/checkout`,
		method: 'POST',
		headers: {
			'Cookie': `gameToken=${GAME_ADMIN_ACCESS_TOKEN}`
		},
		json: true
	}, 'checking out with Ether', testingCarts, function (cart) {
		return {
			requestedServices: buildRequestList({}, cart),
			paymentMethod: 'ETHER'
		};
	});

	// Exit the stress test.
	process.exit();
})();

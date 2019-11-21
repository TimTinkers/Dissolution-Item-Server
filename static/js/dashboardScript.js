'use strict';

// Store our access token as a constant.
let GAME_TOKEN;
let USER_ADDRESS;

// Track the list of game items which can be ascended.
let gameItems = [];
let ascensionItems = {};
let checkoutItems = {};

// A helper function to show an error message on the page.
function showError (errorMessage) {
	let errorBox = $('#errorBox');
	errorBox.html(errorMessage);
	errorBox.show();
};

// A helper function to show a status message on the page.
function showStatusMessage (statusMessage) {
	let messageBox = $('#messageBox');
	messageBox.html(statusMessage);
	messageBox.show();
};

// Refresh the recent user's inventory.
async function refreshInventory () {
	try {
		let inventoryResponse = await $.ajax({
			url: window.serverData.inventoryUri,
			headers: { 'Authorization': 'Bearer ' + GAME_TOKEN }
		});

		// Update the list of this player's assets that reside solely on the game database.
		let updatedListGame = $('<ul id="ownedListGame" style="list-style-type:circle"></ul>');
		let inventory = inventoryResponse.inventory;
		if (inventory.length > 0) {
			$('#ownedTitleGame').html('You own the following in-game assets:');
		}
		let updatedGameItems = [];
		for (let i = 0; i < inventory.length; i++) {
			let item = inventory[i];
			let itemId = item.itemId;
			let itemAmount = item.amount;

			// Try to retrieve metadata about each item.
			try {
				let itemMetadataResponse = await $.ajax({
					url: window.serverData.metadataUri + itemId
				});
				let itemMetadata = itemMetadataResponse.metadata;
				let itemName = itemMetadata.name;
				let itemImage = itemMetadata.image;
				let itemDescription = itemMetadata.description;

				updatedGameItems.push({
					id: itemId,
					amount: itemAmount,
					name: itemName,
					description: itemDescription,
					image: itemImage
				});

			// If unable to retrieve an item's metadata, flag such an item.
			} catch (error) {
				updatedGameItems.push({
					id: itemId,
					amount: itemAmount,
					name: 'unknown',
					description: 'unable to retrieve metadata',
					image: ''
				});
			}
		}

		// Update our list and remove the loading indicator.
		gameItems = updatedGameItems;

		// Only show the option to mint on items which can be ascended.
		let ascendableItems = new Set();
		try {
			let screeningResponse = await $.post(window.serverData.screeningUri, {
				unscreenedItems: gameItems
			});

			// Display ascendable items within the inventory in a special way.
			if (screeningResponse.status === 'SCREENED') {
				let screenedItems = screeningResponse.screenedItems;
				for (let i = 0; i < screenedItems.length; i++) {
					let item = screenedItems[i];
					let itemAmount = item.amount;
					let itemId = item.id;
					ascendableItems.add(parseInt(itemId));
					let itemName = item.name;
					let itemDescription = item.description;
					updatedListGame.append('<li>' + itemAmount + ' x (' + itemId + ') ' + itemName + ': ' + itemDescription + '\t\t<input id="amount-' + itemId + '" class="input" itemId="' + itemId + '" type="number" value="0" min="0" max="' + itemAmount + '" step="1" style="float: right"/></li>');
				}

			// If there was a screening error, notify the user.
			} else if (screeningResponse.status === 'ERROR') {
				let errorBox = $('#errorBox');
				errorBox.html(screeningResponse.message);
				errorBox.show();

			// Otherwise, display an error about an unknown status.
			} else {
				let errorBox = $('#errorBox');
				errorBox.html('Received unknown message status from the server.');
				errorBox.show();
			}

		// If unable to screen a user's mintable item inventory, show an error.
		} catch (error) {
			showError('Unable to verify item mintability at this time.');
		}

		// Also display the unascendable items.
		for (let i = 0; i < updatedGameItems.length; i++) {
			let item = updatedGameItems[i];
			let itemAmount = item.amount;
			let itemId = item.id;
			let itemName = item.name;
			let itemDescription = item.description;
			if (!ascendableItems.has(parseInt(itemId))) {
				updatedListGame.append('<li>' + itemAmount + ' x (' + itemId + ') ' + itemName + ': ' + itemDescription + '</li>');
			}
		}
		$('#ownedListGame').html(updatedListGame.html());
		$('#gameServerSpinner').remove();

	// If we were unable to retrieve the server inventory, throw error.
	} catch (error) {
		showError('Unable to retrieve the server inventory.');
		$('#ownedListGame').html('Unable to retrieve the server inventory.');
	}

	// Update the list of this user's Enjin-owned items if they have a valid address.
	let connectionData = await $.post('/connect');
	if (connectionData.status === 'LINKED') {
		USER_ADDRESS = connectionData.address;
		let inventory = connectionData.inventory;
		$('#enjinMessage').html('Your Ethereum address is ' + USER_ADDRESS);
		if (inventory.length > 0) {
			$('#ownedTitleEnjin').html('You own the following Enjin ERC-1155 items:');
		}
		$('#linkingQR').empty();
		$('#mintButton').show();
		let updatedListEnjin = $('<ul id="ownedListEnjin" style="list-style-type:circle"></ul>');
		for (let i = 0; i < inventory.length; i++) {
			let item = inventory[i];
			let itemAmount = item.balance;
			let itemId = item['token_id'];
			let itemURI = item.itemURI;

			// Try to retrieve metadata about each item.
			try {
				let itemMetadataResponse = await $.get(itemURI);
				let itemName = itemMetadataResponse.name;
				let itemImage = itemMetadataResponse.image;
				let itemDescription = itemMetadataResponse.description;

				// Update the actual list for display.
				updatedListEnjin.append('<li>' + itemAmount + ' x (' + itemId + ') ' + itemName + ': ' + itemDescription + '</li>');

			// If unable to retrieve an item's metadata, flag such an item.
			} catch (error) {
				updatedListEnjin.append('<li>' + itemAmount + ' x (' + itemId + ') - unable to retrieve metadata.</li>');
			}
		}
		$('#ownedListEnjin').html(updatedListEnjin.html());
		$('#enjinSpinner').remove();

	// Otherwise, notify the user that they must link an Enjin address.
	} else if (connectionData.status === 'MUST_LINK') {
		let code = connectionData.code;
		$('#enjinMessage').html('You must link your Enjin wallet to ' + code);
		$('#linkingQR').html('<img src="' + connectionData.qr + '"></img>');
		$('#ownedTitleEnjin').html('You do not own any Enjin ERC-1155 items.');
		$('#ownedListEnjin').empty();
		$('#mintButton').hide();
		$('#enjinSpinner').remove();

	// Otherwise, display an error from the server.
	} else if (connectionData.status === 'ERROR') {
		let errorBox = $('#errorBox');
		errorBox.html(connectionData.message);
		errorBox.show();

	// Otherwise, display an error about an unknown status.
	} else {
		let errorBox = $('#errorBox');
		errorBox.html('Received unknown message status from the server.');
		errorBox.show();
	}

	// Update the items that are for sale in the store.
	let storeData = await $.post('/sales');
	if (storeData.status === 'SUCCESS') {
		let updatedStoreList = $('<ul id="itemsOnSale" style="list-style-type:circle"></ul>');
		let storeItems = storeData.offers;
		if (storeItems.length > 0) {
			$('#itemsInStock').html('The following items are on sale:');
		}
		for (let i = 0; i < storeItems.length; i++) {
			let item = storeItems[i];
			let serviceId = item.serviceId;
			let availableForSale = item.availableForSale;
			let itemId = item.itemId;
			let itemName = item.name;
			let itemDescription = item.description;
			let itemAmount = item.amount;
			let itemCost = item.cost;

			// Update the actual list for display.
			updatedStoreList.append('<li>' + itemAmount + ' x (' + itemId + ') ' + itemName + ': ' + itemDescription + ' for $' + itemCost + '\t\t<input id="amount-' + serviceId + '" class="input" serviceId="' + serviceId + '" type="number" value="0" min="0" max="' + availableForSale + '" step="1" style="float: right"/></li>');
		}

		// Update our store and remove the loading indicator.
		$('#itemsOnSale').html(updatedStoreList.html());
		$('#itemSaleSpinner').remove();

	// Otherwise, display an error from the server.
	} else if (storeData.status === 'ERROR') {
		let errorBox = $('#errorBox');
		errorBox.html(storeData.message);
		errorBox.show();

	// Otherwise, display an error about an unknown status.
	} else {
		let errorBox = $('#errorBox');
		errorBox.html('Received unknown message status from the server.');
		errorBox.show();
	}
};

// Prepares all services being requested by a user for purchase.
function buildRequestList () {
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

// A function which asynchronously sets up the page.
let setup = async function (config) {
	console.log('Setting up page given configuration ...');

	// Assigning delegate to ascension selection event handler.
	$('#ownedListGame').on('input', '.input', function (changedEvent) {
		let itemValue = parseInt($(this).val());
		let itemId = $(this).attr('itemId');
		ascensionItems[itemId] = itemValue;
		console.log(ascensionItems, checkoutItems);
	});

	// Assigning delegate to purchase checkout event handler.
	$('#itemsOnSale').on('input', '.input', function (changedEvent) {
		let amount = parseInt($(this).val());
		let serviceId = $(this).attr('serviceId');
		checkoutItems[serviceId] = amount;
		console.log(ascensionItems, checkoutItems);
	});

	// Get the user's access token and identity.
	GAME_TOKEN = Cookies.get('gameToken');

	// Try to retrieve the user's profile information.
	try {
		let profileResponse = await $.ajax({
			url: window.serverData.profileUri,
			headers: { 'Authorization': 'Bearer ' + GAME_TOKEN }
		});

		// Get all of the profile fields.
		let username = profileResponse.username;
		let email = profileResponse.email;
		USER_ADDRESS = profileResponse.lastAddress;
		let kills = profileResponse.Kills;
		let deaths = profileResponse.Deaths;
		let assists = profileResponse.Assists;
		let accuracy = profileResponse.Accuracy;
		let wins = profileResponse.Wins;
		let losses = profileResponse.Losses;

		// Display the fields to the user.
		let updatedProfileList = $('<ul id="profileInformation" style="list-style-type:circle"></ul>');
		updatedProfileList.append('<li>Your username: ' + username + '</li>');
		updatedProfileList.append('<li>Your email: ' + email + '</li>');
		updatedProfileList.append('<li>Your kills: ' + kills + '</li>');
		updatedProfileList.append('<li>Your deaths: ' + deaths + '</li>');
		updatedProfileList.append('<li>Your assists: ' + assists + '</li>');
		updatedProfileList.append('<li>Your accuracy: ' + accuracy + '</li>');
		updatedProfileList.append('<li>Your wins: ' + wins + '</li>');
		updatedProfileList.append('<li>Your losses: ' + losses + '</li>');

		// Update our list and remove the loading indicator.
		$('#profileInformation').html(updatedProfileList.html());
		$('#profileSpinner').remove();

	// If unable to retrieve the user profile information, show an error.
	} catch (error) {
		showError('Unable to retrieve user profile.');
	}

	// Assign functionality to the modal's PayPal checkout button.
	paypal.Buttons({
		createOrder: async function () {
			let data = await $.post('/checkout', {
				requestedServices: buildRequestList(),
				paymentMethod: 'PAYPAL'
			});
			return data.orderID;
		},

		// Capture the funds from the transaction and validate approval with server.
		onApprove: async function (data) {
			let status = await $.post('/approve', data);
			if (status === 'OK') {
				console.log('Transaction completed successfully.');
				showStatusMessage('Your purchase was received and is now pending!');
			} else {
				console.error(status, 'Transaction failed.');
			}
		}
	}).render('#paypal-button-container');

	// Assign functionality to the modal's Pay-with-ETH button.
	$('#payWithEther').click(async function () {
		const provider = new ethers.providers.Web3Provider(web3.currentProvider);
		const signer = provider.getSigner();
		const purchaser = web3.eth.accounts[0];

		// Retrieve and sign a payment transaction generated by the server.
		let transaction = await $.post('/checkout', {
			requestedServices: buildRequestList(),
			paymentMethod: 'ETHER',
			purchaser: purchaser
		});
		// transaction.from = web3.eth.accounts[0];
		console.log(transaction);
		await signer.sendTransaction(transaction);
	});

	// Assign functionality to the example logout button.
	$('#logoutButton').click(async function () {
		$.post('/logout', function (data) {
			window.location.replace('/');
		});
	});

	// Periodically refresh the user's inventory.
	let updateStatus = async function () {
		await refreshInventory();
	};
	await updateStatus();
	setInterval(updateStatus, 30000);
};

// Request permission to enable Web3.
window.addEventListener('load', async () => {
	if (window.ethereum) {
		window.web3 = new Web3(window.ethereum);
		try {
			await window.ethereum.enable();
		} catch (error) {
			console.error(error);
		}
	}	else if (window.web3) {
		window.web3 = new Web3(window.web3.currentProvider);
	}	else {
		console.log('Non-Ethereum browser detected. You should consider trying MetaMask!');
	}
});

// Parse the configuration file and pass to setup.
$.getJSON('js/config.json', function (config) {
	setup(config);
});

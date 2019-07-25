// Store our access token as a constant.
var DISSOLUTION_TOKEN;
var USER_ADDRESS;

// A helper function to show an error message on the page.
function showError (errorMessage) {
	var errorBox = $('#errorBox');
	errorBox.html(errorMessage);
	errorBox.show();
};

// Refresh the recent user's inventory.
async function refreshInventory () {

	// Try to retrieve the user's server inventory.
	try {
		var inventoryResponse = await $.ajax({
			url : 'https://api.dissolution.online/core/master/inventory/',
			headers: { 'Authorization' : 'Bearer ' + DISSOLUTION_TOKEN }
		});

		// Update the list of this player's assets that reside solely on the game database.
		var updatedListGame = $("<ul id=\"ownedListGame\" style=\"list-style-type:circle\"></ul>");
		var inventory = inventoryResponse.inventory;
		if (inventory.length > 0) {
			$('#ownedTitleGame').html('You own the game assets from the Dissolution servers:');
		}
		for (var i = 0; i < inventory.length; i++) {
			var item = inventory[i];
			var itemId = item.itemId;
			var itemAmount = item.amount;

			// Try to retrieve metadata about each item.
			try {
				var itemMetadataResponse = await $.ajax({
					url : 'https://api.dissolution.online/core/master/item/' + itemId
				});
				var itemMetadata = itemMetadataResponse.metadata;
				var itemName = itemMetadata.name;
				var itemImage = itemMetadata.image;
				var itemDescription = itemMetadata.description;

				// Update the actual list for display.
				updatedListGame.append("<li>" + itemAmount + " x (" + itemId + ") " + itemName + ": " + itemDescription + "</li>");

			// If unable to retrieve an item's metadata, flag such an item.
			} catch (error) {
				updatedListGame.append("<li>" + itemAmount + " x (" + itemId + ") - unable to retrieve metadata. </li>");
			}
		}

		// Update our list and remove the loading indicator.
		$("#ownedListGame").html(updatedListGame.html());
		$('#gameServerSpinner').remove();

	// If we were unable to retrieve the server inventory, throw error.
	} catch (error) {
		showError('Unable to retrieve the server inventory.');
		$("#ownedListGame").html('Unable to retrieve the server inventory.');
	}

	// Update the list of this user's Enjin-owned items if they have a valid address.
	var connectionData = await $.post("/connect");
	if (connectionData.status === 'LINKED') {
		$('#linkingQR').empty();
		var address = connectionData.address;
		var inventory = connectionData.inventory;
		$('#enjinMessage').html("Your Ethereum address is " + address);
		if (inventory.length > 0) {
			$('#ownedTitleEnjin').html('You own the following Enjin ERC-1155 items:');
		}
		var updatedListEnjin = $("<ul id=\"ownedListEnjin\" style=\"list-style-type:circle\"></ul>");
		for (var i = 0; i < inventory.length; i++) {
			var item = inventory[i];
			var itemAmount = item.balance;
			var itemId = item['token_id'];
			var itemURI = item.itemURI;

			// Try to retrieve metadata about each item.
			try {
				var itemMetadataResponse = await $.get(itemURI);
				var itemName = itemMetadataResponse.name;
				var itemImage = itemMetadataResponse.image;
				var itemDescription = itemMetadataResponse.description;

				// Update the actual list for display.
				updatedListEnjin.append("<li>" + itemAmount + " x (" + itemId + ") " + itemName + ": " + itemDescription + "</li>");

			// If unable to retrieve an item's metadata, flag such an item.
			} catch (error) {
				updatedListEnjin.append("<li>" + itemAmount + " x (" + itemId + ") - unable to retrieve metadata. </li>");
			}
		}
		$("#ownedListEnjin").html(updatedListEnjin.html());
		$('#enjinSpinner').remove();

	// Otherwise, notify the user that they must link an Enjin address.
	} else if (connectionData.status === 'MUST_LINK') {
		var code = connectionData.code;
		$('#enjinMessage').html("You must link your Enjin wallet to " + code);
		$('#linkingQR').html("<img src=\"" + connectionData.qr + "\"></img>");
		$('#ownedTitleEnjin').html('You do not own any Enjin ERC-1155 items.');
		$("#ownedListEnjin").empty();
		$('#enjinSpinner').remove();

	// Otherwise, display an error from the server.
	} else if (connectionData.status === 'ERROR') {
		var errorBox = $('#errorBox');
		errorBox.html(connectionData.message);
		errorBox.show();

	// Otherwise, display an error about an unknown status.
	} else {
		var errorBox = $('#errorBox');
		errorBox.html('Received unknown message status from the server.');
		errorBox.show();
	}
};

// A function which asynchronously sets up the page.
var setup = async function (config) {
	console.log('Setting up page given configuration ...');

	// Get the user's access token and identity.
	DISSOLUTION_TOKEN = Cookies.get('dissolutionToken');

	// Try to retrieve the user's profile information.
	try {
		var profileResponse = await $.ajax({
			url : 'https://api.dissolution.online/core/master/profile/',
			headers: { 'Authorization' : 'Bearer ' + DISSOLUTION_TOKEN }
		});

		// Get all of the profile fields.
		var userId = profileResponse.userId;
		var username = profileResponse.username;
		var email = profileResponse.email;
		USER_ADDRESS = profileResponse.lastAddress;
		var isAdmin = profileResponse.isAdmin;
		var kills = profileResponse.Kills;
		var deaths = profileResponse.Deaths;
		var assists = profileResponse.Assists;
		var accuracy = profileResponse.Accuracy;
		var wins = profileResponse.Wins;
		var losses = profileResponse.Losses;

		// Display the fields to the user.
		var updatedProfileList = $("<ul id=\"profileInformation\" style=\"list-style-type:circle\"></ul>");
		updatedProfileList.append("<li>Your username: " + username + "</li>");
		updatedProfileList.append("<li>Your email: " + email + "</li>");
		updatedProfileList.append("<li>Your kills: " + kills + "</li>");
		updatedProfileList.append("<li>Your deaths: " + deaths + "</li>");
		updatedProfileList.append("<li>Your assists: " + assists + "</li>");
		updatedProfileList.append("<li>Your accuracy: " + accuracy + "</li>");
		updatedProfileList.append("<li>Your wins: " + wins + "</li>");
		updatedProfileList.append("<li>Your losses: " + losses + "</li>");

		// Update our list and remove the loading indicator.
		$("#profileInformation").html(updatedProfileList.html());
		$('#profileSpinner').remove();

	// If unable to retrieve the user profile information, show an error.
	} catch (error) {
		showError('Unable to retrieve user profile.');
	}

	/*
	// Assign functionality to the example mint button.
	// This simplified example only works because I've made my MetaMask wallet an authority.
	$("#mintButton").click(async function() {
		var mintItemId = parseInt($("#metadataInput").val());

		// Check for the existence of any such item type.
		var userId = Cookies.get('userId');
		var hasItem = false;
		var mintItemName = "";
		await $.get("/getItems?userId=" + userId, function (data) {
			for (var i = 0; i < data.length; i++) {
				var item = data[i];
				var balance = parseInt(item.balance, 10);
				var itemId = parseInt(item.item_id)
				if (itemId === mintItemId && balance > 0) {
					hasItem = true;
					mintItemName = item.item_name;
					break;
				}
			}
		});

		// Remove an instance of this item from the database if the user has one.
		if (hasItem) {
			await $.post("/removeItem", { userId: userId, itemName: mintItemName, itemId: mintItemId });

			// Mint the new token for this user.
			console.log("**** itemName: " + mintItemName + ", itemId: " + mintItemId);
			var gasLimit = await promisify(cb => FromExchange.mint.estimateGas(web3.eth.defaultAccount, mintItemName, { from: web3.eth.defaultAccount }, cb));
			const transactionData = {
				from: web3.eth.defaultAccount,
				gas: gasLimit,
				gasPrice: 21000000000
			};
			await promisify(cb => FromExchange.mint.sendTransaction(web3.eth.defaultAccount, mintItemName, transactionData, cb));
		}
	});
	*/

	// Assign functionality to the example logout button.
	$("#logoutButton").click(async function() {
		$.post("/logout", function (data) {
			window.location.replace("/");
		});
	});

	// Periodically refresh the user's inventory.
	var updateStatus = async function () {
		await refreshInventory();
	};
	await updateStatus();
	setInterval(updateStatus, 15000);
};

// Parse the configuration file and pass to setup.
$.getJSON("js/config.json", function (config) {
	setup(config);
});

// Store our access token as a constant.
var DISSOLUTION_TOKEN;
var USER_ADDRESS;

// Track the list of game items which can be ascended.
var gameItems = [];

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
		var updatedGameItems = [];
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

				updatedGameItems.push({
					id : itemId,
					amount : itemAmount,
					name : itemName,
					description : itemDescription,
					image : itemImage
				});

			// If unable to retrieve an item's metadata, flag such an item.
			} catch (error) {
				updatedListGame.append("<li>" + itemAmount + " x (" + itemId + ") - unable to retrieve metadata. </li>");
			}
		}

		// Update our list and remove the loading indicator.
		gameItems = updatedGameItems;
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
		var address = connectionData.address;
		var inventory = connectionData.inventory;
		$('#enjinMessage').html("Your Ethereum address is " + address);
		if (inventory.length > 0) {
			$('#ownedTitleEnjin').html('You own the following Enjin ERC-1155 items:');
		}
		$('#linkingQR').empty();
		$('#mintButton').show();
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
		$('#mintButton').hide();
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

	// Assign functionality to the item minting button.
	$("#mintButton").click(async function() {
		$("#mintingCheckoutContent").empty();
		if (gameItems.length > 0) {
			var updatedModalContent = $("<ul id=\"checkoutList\" style=\"list-style-type:circle\"></ul>");
			for (var i = 0; i < gameItems.length; i++) {
				var item = gameItems[i];
				var itemAmount = item.amount;
				var itemId = item.id;
				var itemName = item.name;

				updatedModalContent.append("<li>(" + itemId + ") " + itemName + "\t\t<input type=\"number\" value=\"0\" min=\"0\" max=\"" + itemAmount + "\" step=\"1\" style=\"float: right\"/></li>");
			}
			$("#mintingCheckoutContent").html(updatedModalContent.html());

		} else {
			$("#mintingCheckoutContent").html("You have no items which can be ascended to Enjin at this time.");
		}
	});

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

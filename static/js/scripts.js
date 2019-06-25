async function refreshInventory () {
	console.log('Refreshing inventory ...');

	// Get the user's access token and identity.
	var dissolutionToken = Cookies.get('dissolutionToken');
	var inventoryResponse = await $.ajax({
		url : 'https://api.dissolution.online/core/master/inventory/',
		headers: { 'Authorization' : 'Bearer ' + dissolutionToken }
	});

	// Update the list of this player's assets that reside solely on the game database.
	var updatedListGame = $("<ul id=\"ownedListGame\" style=\"list-style-type:circle\"></ul>");
	var inventory = inventoryResponse.inventory;
	for (var i = 0; i < inventory.length; i++) {
		var item = inventory[i];
		var itemId = item.itemId;
		var itemAmount = item.amount;

		var itemMetadataResponse = await $.ajax({
			url : 'https://api.dissolution.online/core/master/item/' + itemId
		});
		var itemMetadata = itemMetadataResponse.metadata;

		var itemName = itemMetadata.name;
		var itemImage = itemMetadata.image;
		var itemDescription = itemMetadata.description;

		updatedListGame.append("<li>" + itemAmount + " x (" + itemId + ") " + itemName + ": " + itemDescription + "</li>");
	}
	$("#ownedListGame").html(updatedListGame.html());

	/*
	// Update the list of this user's ERC721 assets on the "from" exchange.
	var fromTokens = await promisify(cb => FromExchange.tokensOf(web3.eth.defaultAccount, cb));
	var updatedListFrom = $("<ul id=\"ownedListFrom\" style=\"list-style-type:circle\"></ul>");
	for (var i = 0; i < fromTokens.length; i++) {
		var tokenID = new web3.BigNumber(fromTokens[i]);
		var metadataString = await promisify(cb => FromExchange.tokenMetadata(tokenID, cb));

		// Color the entry red if it's been tokenized.
		updatedListFrom.append("<li style=\"color:red;\">" + tokenID + ": " + metadataString + "</li>");
	}
	$("#ownedListFrom").html(updatedListFrom.html());
	*/
};

// A function which asynchronously sets up the page.
var setup = async function (config) {
	console.log('Setting up page given configuration ...');

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
console.log('Page loaded.');
$.getJSON("js/config.json", function (config) {
	console.log('Retrieving configuration ...');
	console.log(config);
	setup(config);
});

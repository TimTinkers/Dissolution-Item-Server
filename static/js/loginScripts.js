// A function which asynchronously sets up the page.
var setup = async function (config) {

	// Check for an error message to display.
	var errorMessage = window.serverData.error;
	if (errorMessage) {
		var errorBox = $('#errorBox');
		errorBox.html(errorMessage);
		errorBox.show();
	}
}

// Once the window has fully loaded, begin page setup.
window.addEventListener('load', function () {

	// Parse the configuration file and pass to setup.
	$.getJSON('js/config.json', function (config) {
		setup(config);
	});
});

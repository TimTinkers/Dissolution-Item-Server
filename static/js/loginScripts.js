'use strict';

// A function which asynchronously sets up the page.
var setup = async function () {
	let errorMessage = window.serverData.error;
	if (errorMessage) {
		let errorBox = $('#errorBox');
		errorBox.html(errorMessage);
		errorBox.show();
	}
};

// After window load, begin page setup by parsing any client-side config.
window.addEventListener('load', function () {
	setup();
});

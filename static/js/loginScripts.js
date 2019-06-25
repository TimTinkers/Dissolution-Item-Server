// A helper which can seamlessly convert contract calls to Promises. Thanks to:
// https://ethereum.stackexchange.com/questions/11444/web3-js-with-promisified-api/24238#24238
// http://shawntabrizi.com/crypto/making-web3-js-work-asynchronously-javascript-promises-await/
const promisify = (inner) =>
new Promise((resolve, reject) =>
	inner((err, res) => {
		if (err) {
			reject(err);
		} else {
			resolve(res);
		}
	})
);

// A function which asynchronously sets up the page.
var setup = async function (config) {

	// Poll the user's active wallet address every few seconds.
	var update = async function () {
	};
	update();
	setInterval(update, 2500);
}

// Once the window has fully loaded, begin page setup.
window.addEventListener("load", function () {

	// Parse the configuration file and pass to setup.
	$.getJSON("js/config.json", function (config) {
	});
});

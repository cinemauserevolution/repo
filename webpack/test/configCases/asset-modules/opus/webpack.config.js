module.exports = {
	mode: "development",
	module: {
		rules: [
			{
				test: /\.opus$/,
				type: "asset"
			}
		]
	},
	experiments: {
		asset: true
	}
};

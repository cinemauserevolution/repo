module.exports = {
	mode: "production",
	entry: "./index",
	stats: {
		reasons: false,
		modules: false,
		chunks: true,
		chunkRelations: true,
		chunkModules: true,
		chunkOrigins: true
	}
};

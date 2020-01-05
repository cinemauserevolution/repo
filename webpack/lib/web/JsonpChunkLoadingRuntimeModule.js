/*
	MIT License http://www.opensource.org/licenses/mit-license.php
*/

"use strict";

const RuntimeGlobals = require("../RuntimeGlobals");
const RuntimeModule = require("../RuntimeModule");
const Template = require("../Template");
const chunkHasJs = require("../javascript/JavascriptModulesPlugin").chunkHasJs;
const compileBooleanMatcher = require("../util/compileBooleanMatcher");
const getEntryInfo = require("./JsonpHelpers").getEntryInfo;

class JsonpChunkLoadingRuntimeModule extends RuntimeModule {
	constructor(runtimeRequirements, jsonpScript, linkPreload, linkPrefetch) {
		super("jsonp chunk loading", 10);
		this.runtimeRequirements = runtimeRequirements;
		this.jsonpScript = jsonpScript;
		this.linkPreload = linkPreload;
		this.linkPrefetch = linkPrefetch;
	}

	/**
	 * @returns {string} runtime code
	 */
	generate() {
		const { compilation, chunk, jsonpScript, linkPreload, linkPrefetch } = this;
		const { runtimeTemplate, chunkGraph, outputOptions } = compilation;
		const fn = RuntimeGlobals.ensureChunkHandlers;
		const withLoading = this.runtimeRequirements.has(
			RuntimeGlobals.ensureChunkHandlers
		);
		const needEntryDeferringCode = chunk => {
			for (const chunkGroup of chunk.groupsIterable) {
				if (chunkGroup.chunks.length > 1) return true;
			}
			return false;
		};
		const withDefer = needEntryDeferringCode(chunk);
		const withHmr = this.runtimeRequirements.has(
			RuntimeGlobals.hmrDownloadUpdateHandlers
		);
		const withHmrManifest = this.runtimeRequirements.has(
			RuntimeGlobals.hmrDownloadManifest
		);
		const withPrefetch = this.runtimeRequirements.has(
			RuntimeGlobals.prefetchChunkHandlers
		);
		const withPreload = this.runtimeRequirements.has(
			RuntimeGlobals.preloadChunkHandlers
		);
		const entries = getEntryInfo(chunkGraph, chunk);
		const jsonpObject = `${outputOptions.globalObject}[${JSON.stringify(
			outputOptions.jsonpFunction
		)}]`;
		const hasJsMatcher = compileBooleanMatcher(
			chunkGraph.getChunkConditionMap(chunk, chunkHasJs)
		);
		return Template.asString([
			"// object to store loaded and loading chunks",
			"// undefined = chunk not loaded, null = chunk preloaded/prefetched",
			"// Promise = chunk loading, 0 = chunk loaded",
			"var installedChunks = {",
			Template.indent(
				chunk.ids.map(id => `${JSON.stringify(id)}: 0`).join(",\n")
			),
			"};",
			"",
			withDefer
				? Template.asString([
						"var deferredModules = [",
						Template.indent(entries.map(e => JSON.stringify(e)).join(",\n")),
						"];"
				  ])
				: "",
			withLoading
				? Template.asString([
						`${fn}.j = ${runtimeTemplate.basicFunction(
							"chunkId, promises",
							hasJsMatcher !== false
								? Template.indent([
										"// JSONP chunk loading for javascript",
										`var installedChunkData = ${RuntimeGlobals.hasOwnProperty}(installedChunks, chunkId) ? installedChunks[chunkId] : undefined;`,
										'if(installedChunkData !== 0) { // 0 means "already installed".',
										Template.indent([
											"",
											'// a Promise means "currently loading".',
											"if(installedChunkData) {",
											Template.indent([
												"promises.push(installedChunkData[2]);"
											]),
											"} else {",
											Template.indent([
												hasJsMatcher === true
													? "if(true) { // all chunks have JS"
													: `if(${hasJsMatcher("chunkId")}) {`,
												Template.indent([
													"// setup Promise in chunk cache",
													`var promise = new Promise(${runtimeTemplate.basicFunction(
														"resolve, reject",
														[
															`installedChunkData = installedChunks[chunkId] = [resolve, reject];`
														]
													)});`,
													"promises.push(installedChunkData[2] = promise);",
													"",
													"// start chunk loading",
													`var url = ${RuntimeGlobals.publicPath} + ${RuntimeGlobals.getChunkScriptFilename}(chunkId);`,
													`var loadingEnded = ${runtimeTemplate.basicFunction(
														"",
														[
															`if(${RuntimeGlobals.hasOwnProperty}(installedChunks, chunkId)) {`,
															Template.indent([
																"installedChunkData = installedChunks[chunkId];",
																"if(installedChunkData !== 0) installedChunks[chunkId] = undefined;",
																"if(installedChunkData) return installedChunkData[1];"
															]),
															"}"
														]
													)};`,
													jsonpScript.call("", chunk),
													"document.head.appendChild(script);"
												]),
												"} else installedChunks[chunkId] = 0;",
												"",
												withHmr
													? "if(currentUpdateChunks && currentUpdateChunks[chunkId]) promises.push(loadUpdateChunk(chunkId));"
													: "// no HMR"
											]),
											"}"
										]),
										"}"
								  ])
								: Template.indent([
										"installedChunks[chunkId] = 0;",
										"",
										withHmr
											? "if(currentUpdateChunks && currentUpdateChunks[chunkId]) promises.push(loadUpdateChunk(chunkId));"
											: "// no HMR"
								  ])
						)};`
				  ])
				: "// no chunk on demand loading",
			"",
			withPrefetch && hasJsMatcher !== false
				? `${
						RuntimeGlobals.prefetchChunkHandlers
				  }.j = ${runtimeTemplate.basicFunction("chunkId", [
						`if((!${
							RuntimeGlobals.hasOwnProperty
						}(installedChunks, chunkId) || installedChunks[chunkId] === undefined) && ${
							hasJsMatcher === true ? "true" : hasJsMatcher("chunkId")
						}) {`,
						Template.indent([
							"installedChunks[chunkId] = null;",
							linkPrefetch.call("", chunk),
							"document.head.appendChild(link);"
						]),
						"}"
				  ])};`
				: "// no prefetching",
			"",
			withPreload && hasJsMatcher !== false
				? `${
						RuntimeGlobals.preloadChunkHandlers
				  }.j = ${runtimeTemplate.basicFunction("chunkId", [
						`if((!${
							RuntimeGlobals.hasOwnProperty
						}(installedChunks, chunkId) || installedChunks[chunkId] === undefined) && ${
							hasJsMatcher === true ? "true" : hasJsMatcher("chunkId")
						}) {`,
						Template.indent([
							"installedChunks[chunkId] = null;",
							linkPreload.call("", chunk),
							"document.head.appendChild(link);"
						]),
						"}"
				  ])};`
				: "// no preloaded",
			"",
			withHmr
				? Template.asString([
						"var currentUpdateChunks;",
						"var currentUpdate;",
						"var currentUpdateRuntime;",
						"var currentUpdatedModulesList;",
						"var waitingUpdateResolves = {};",
						"function loadUpdateChunk(chunkId) {",
						Template.indent([
							`return new Promise(${runtimeTemplate.basicFunction(
								"resolve, reject",
								[
									"waitingUpdateResolves[chunkId] = resolve;",
									"// start update chunk loading",
									`var url = ${RuntimeGlobals.publicPath} + ${RuntimeGlobals.getChunkUpdateScriptFilename}(chunkId);`,
									`var loadingEnded = ${runtimeTemplate.basicFunction("", [
										"if(waitingUpdateResolves[chunkId]) {",
										Template.indent([
											"waitingUpdateResolves[chunkId] = undefined",
											"return reject;"
										]),
										"}"
									])};`,
									jsonpScript.call("", chunk),
									"document.head.appendChild(script);"
								]
							)});`
						]),
						"}",
						"",
						`${outputOptions.globalObject}[${JSON.stringify(
							outputOptions.hotUpdateFunction
						)}] = ${runtimeTemplate.basicFunction(
							"chunkId, moreModules, runtime",
							[
								"for(var moduleId in moreModules) {",
								Template.indent([
									`if(${RuntimeGlobals.hasOwnProperty}(moreModules, moduleId)) {`,
									Template.indent([
										"currentUpdate[moduleId] = moreModules[moduleId];",
										"if(currentUpdatedModulesList) currentUpdatedModulesList.push(moduleId);"
									]),
									"}"
								]),
								"}",
								"if(runtime) currentUpdateRuntime.push(runtime);",
								"if(waitingUpdateResolves[chunkId]) {",
								Template.indent([
									"waitingUpdateResolves[chunkId]();",
									"waitingUpdateResolves[chunkId] = undefined;"
								]),
								"}"
							]
						)};`,
						"",
						`${
							RuntimeGlobals.hmrDownloadUpdateHandlers
						}.jsonp = ${runtimeTemplate.basicFunction(
							"chunkIds, removedChunks, removedModules, promises, applyHandlers, updatedModulesList",
							[
								`applyHandlers.push(${runtimeTemplate.basicFunction("options", [
									"currentUpdateChunks = undefined;",
									Template.getFunctionContent(
										require("../hmr/JavascriptHotModuleReplacement.runtime.js")
									)
										.replace(/\$options\$/g, "options")
										.replace(/\$updateModuleFactories\$/g, "currentUpdate")
										.replace(
											/\$updateRuntimeModules\$/g,
											"currentUpdateRuntime"
										)
										.replace(/\$moduleCache\$/g, RuntimeGlobals.moduleCache)
										.replace(/\$hmrModuleData\$/g, RuntimeGlobals.hmrModuleData)
										.replace(
											/\$moduleFactories\$/g,
											RuntimeGlobals.moduleFactories
										)
										.replace(
											/\/\/ \$dispose\$/g,
											Template.asString([
												runtimeTemplate.forEach(
													"chunkId",
													"removedChunks",
													"delete installedChunks[chunkId];"
												)
											])
										)
								])});`,
								"currentUpdateChunks = {};",
								`currentUpdate = removedModules.reduce(${runtimeTemplate.basicFunction(
									"obj, key",
									["obj[key] = false;", "return obj;"]
								)}, {});`,
								"currentUpdateRuntime = [];",
								"currentUpdatedModulesList = updatedModulesList;",
								runtimeTemplate.forEach("chunkId", "chunkIds", [
									`if(${RuntimeGlobals.hasOwnProperty}(installedChunks, chunkId) && installedChunks[chunkId] !== undefined) {`,
									Template.indent(["promises.push(loadUpdateChunk(chunkId));"]),
									"}",
									"currentUpdateChunks[chunkId] = true;"
								])
							]
						)};`
				  ])
				: "// no HMR",
			"",
			withHmrManifest
				? Template.asString([
						`${
							RuntimeGlobals.hmrDownloadManifest
						} = ${runtimeTemplate.basicFunction("", [
							'if (typeof fetch === "undefined") throw new Error("No browser support: need fetch API");',
							`return fetch(${RuntimeGlobals.publicPath} + ${
								RuntimeGlobals.getUpdateManifestFilename
							}()).then(${runtimeTemplate.basicFunction("response", [
								"if(response.status === 404) return; // no update available",
								'if(!response.ok) throw new Error("Failed to fetch update manifest " + response.statusText);',
								"return response.json();"
							])});`
						])};`
				  ])
				: "// no HMR manifest",
			"",
			withDefer
				? Template.asString([
						`var checkDeferredModules = ${runtimeTemplate.basicFunction(
							"",
							""
						)};`,
						"function checkDeferredModulesImpl() {",
						Template.indent([
							"var result;",
							"for(var i = 0; i < deferredModules.length; i++) {",
							Template.indent([
								"var deferredModule = deferredModules[i];",
								"var fulfilled = true;",
								"for(var j = 1; j < deferredModule.length; j++) {",
								Template.indent([
									"var depId = deferredModule[j];",
									"if(installedChunks[depId] !== 0) fulfilled = false;"
								]),
								"}",
								"if(fulfilled) {",
								Template.indent([
									"deferredModules.splice(i--, 1);",
									"result = " +
										"__webpack_require__(" +
										`${RuntimeGlobals.entryModuleId} = deferredModule[0]);`
								]),
								"}"
							]),
							"}",
							"if(deferredModules.length === 0) {",
							Template.indent([
								`${RuntimeGlobals.startup}();`,
								`${RuntimeGlobals.startup} = ${runtimeTemplate.basicFunction(
									"",
									""
								)}`
							]),
							"}",
							"return result;"
						]),
						"}",
						`${RuntimeGlobals.startup} = ${runtimeTemplate.basicFunction("", [
							"// reset startup function so it can be called again when more startup code is added",
							`${RuntimeGlobals.startup} = ${runtimeTemplate.basicFunction(
								"",
								""
							)}`,
							"jsonpArray = jsonpArray.slice();",
							"for(var i = 0; i < jsonpArray.length; i++) webpackJsonpCallback(jsonpArray[i]);",
							"return (checkDeferredModules = checkDeferredModulesImpl)();"
						])};`
				  ])
				: "// no deferred startup",
			"",
			withDefer || withLoading
				? Template.asString([
						"// install a JSONP callback for chunk loading",
						"function webpackJsonpCallback(data) {",
						Template.indent([
							"var chunkIds = data[0];",
							"var moreModules = data[1];",
							withDefer ? "var executeModules = data[2];" : "",
							"var runtime = data[3];",
							'// add "moreModules" to the modules object,',
							'// then flag all "chunkIds" as loaded and fire callback',
							"var moduleId, chunkId, i = 0, resolves = [];",
							"for(;i < chunkIds.length; i++) {",
							Template.indent([
								"chunkId = chunkIds[i];",
								`if(${RuntimeGlobals.hasOwnProperty}(installedChunks, chunkId) && installedChunks[chunkId]) {`,
								Template.indent("resolves.push(installedChunks[chunkId][0]);"),
								"}",
								"installedChunks[chunkId] = 0;"
							]),
							"}",
							"for(moduleId in moreModules) {",
							Template.indent([
								`if(${RuntimeGlobals.hasOwnProperty}(moreModules, moduleId)) {`,
								Template.indent(
									`${RuntimeGlobals.moduleFactories}[moduleId] = moreModules[moduleId];`
								),
								"}"
							]),
							"}",
							"if(runtime) runtime(__webpack_require__);",
							"if(parentJsonpFunction) parentJsonpFunction(data);",
							"while(resolves.length) {",
							Template.indent("resolves.shift()();"),
							"}",
							withDefer
								? Template.asString([
										"",
										"// add entry modules from loaded chunk to deferred list",
										"if(executeModules) deferredModules.push.apply(deferredModules, executeModules);",
										"",
										"// run deferred modules when all chunks ready",
										"return checkDeferredModules();"
								  ])
								: ""
						]),
						"};",
						"",
						`var jsonpArray = ${jsonpObject} = ${jsonpObject} || [];`,
						"var oldJsonpFunction = jsonpArray.push.bind(jsonpArray);",
						"jsonpArray.push = webpackJsonpCallback;",
						"var parentJsonpFunction = oldJsonpFunction;"
				  ])
				: "// no jsonp function"
		]);
	}
}

module.exports = JsonpChunkLoadingRuntimeModule;

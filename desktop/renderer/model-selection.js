(function initModelSelection(globalScope) {
	function resolveCustomProviderModel(previousModel, models, preferredProviderId) {
		const availableModels = Array.isArray(models) ? models : [];
		const previous = availableModels.find((model) => (
			model.provider === previousModel?.provider && model.id === previousModel?.id
		));
		if (previous) return { provider: previous.provider, id: previous.id };

		const custom = availableModels.find((model) => model.provider === preferredProviderId)
			?? availableModels.find((model) => model.provider === "other");
		return custom ? { provider: custom.provider, id: custom.id } : undefined;
	}

	const helpers = Object.freeze({ resolveCustomProviderModel });
	if (typeof module === "object" && module.exports) module.exports = helpers;
	globalScope.metisModelSelection = helpers;
})(typeof window === "undefined" ? globalThis : window);

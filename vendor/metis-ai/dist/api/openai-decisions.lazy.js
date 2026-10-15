export const openAIDecisionsApi = () => ({
    classify: async (model, context, options) => (await import("./openai-decisions.js")).classify(model, context, options),
});
//# sourceMappingURL=openai-decisions.lazy.js.map
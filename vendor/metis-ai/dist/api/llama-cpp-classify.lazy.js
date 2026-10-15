export const llamaCppClassifyApi = () => ({
    classify: async (model, context, options) => (await import("./llama-cpp-classify.js")).classify(model, context, options),
});
//# sourceMappingURL=llama-cpp-classify.lazy.js.map
export const cloudflareWorkersAISystemOneApi = () => ({
    classify: async (model, context, options) => (await import("./cloudflare-workers-ai-system-one.js")).classify(model, context, options),
});
//# sourceMappingURL=cloudflare-workers-ai-system-one.lazy.js.map
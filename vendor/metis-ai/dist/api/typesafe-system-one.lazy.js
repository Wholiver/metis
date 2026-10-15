export const typesafeSystemOneApi = () => ({
    classify: async (model, context, options) => (await import("./typesafe-system-one.js")).classify(model, context, options),
});
//# sourceMappingURL=typesafe-system-one.lazy.js.map
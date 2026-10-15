function _flattenModelCatalog(groups, type) {
    return Object.fromEntries(Object.values(groups)
        .flatMap((models) => Object.values(models))
        .filter((model) => model.type === type || (!model.type && type === "chat"))
        .map((model) => [model.id, model]));
}
export function flattenChatModelCatalog(_provider, groups) {
    return _flattenModelCatalog(groups, "chat");
}
export function flattenImageModelCatalog(_provider, groups) {
    return _flattenModelCatalog(groups, "image");
}
export function flattenClassifierModelCatalog(_provider, groups) {
    return _flattenModelCatalog(groups, "classifier");
}
//# sourceMappingURL=model-catalog.js.map
export function flattenModelCatalog(groupsOrProvider, typeOrGroups) {
    if (typeof typeOrGroups === "string") {
        return _flattenModelCatalog(groupsOrProvider, typeOrGroups);
    }
    return flattenChatModelCatalog(groupsOrProvider, typeOrGroups);
}

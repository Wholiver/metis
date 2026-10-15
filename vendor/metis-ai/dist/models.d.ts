import { type AuthResolutionOverrides } from "./auth/resolve.ts";
import type { AuthCheck, AuthContext, AuthInteraction, AuthOperationOptions, AuthResult, AuthType, Credential, CredentialStore, LoginOptions, ProviderAuth } from "./auth/types.ts";
import { type ModelsStore, type ModelsStoreEntry } from "./models-store.ts";
import type { AnyModel, Api, ApiStreamOptions, AssistantImages, AssistantMessage, AssistantMessageEventStream, ClassifierApi, ClassifierContext, ClassifierModel, ClassifierOptions, ClassifierResult, Context, DeferredCancelOptions, DeferredFetchOptions, DeferredHandle, ImageApi, ImageModel, ImagesContext, ImagesOptions, Model, ModelThinkingLevel, ModelType, ModelTypeMap, ProviderClassifier, ProviderHeaders, ProviderImages, ProviderStreams, SimpleStreamOptions, TranscriptContext, Usage } from "./types.ts";
export { ModelsError, type ModelsErrorCode } from "./auth/resolve.ts";
export { getModelType, isModelType } from "./utils/model-operations.ts";
export interface ModelsPublication {
    /** Provider-selected persisted catalog. Omit to leave storage unchanged; null deletes it. */
    persist?: ModelsStoreEntry | null;
    /** Optional synchronous update of provider-private in-memory catalog state. */
    update?: () => void;
}
export interface RefreshModelsContext {
    /** Effective configured credential. OAuth credentials are refreshed before network access. */
    credential?: Credential;
    /** Immutable provider-scoped catalog snapshot captured before this refresh phase. */
    stored?: Readonly<ModelsStoreEntry>;
    /**
     * Generation-checked publication. Persistence policy remains provider-owned;
     * the update runs synchronously only after the selected persistence mutation.
     */
    publish(publication: ModelsPublication): Promise<boolean>;
    /** False during offline/cache-only initialization. */
    allowNetwork: boolean;
    /** Bypass provider freshness checks and fetch immediately when network access is allowed. */
    force?: boolean;
    /** Always present, including when the public refresh caller omits its optional signal. */
    signal: AbortSignal;
    /**
     * Base URL of the registered provider, including configuration overrides that wrappers apply
     * outside the provider receiving this context.
     */
    baseUrl?: string;
}
export interface ModelsRefreshOptions {
    allowNetwork?: boolean;
    /** Restrict refresh to these provider IDs. Unknown and static providers are ignored. */
    providers?: readonly string[];
    /** Bypass provider freshness checks and fetch immediately when network access is allowed. */
    force?: boolean;
    signal?: AbortSignal;
}
export interface ModelsRefreshResult {
    aborted: boolean;
    errors: ReadonlyMap<string, Error>;
}
export interface ModelsRequestTransforms {
    /** Transform fully assembled model/auth/request headers before provider dispatch. */
    transformHeaders?: (headers: ProviderHeaders) => ProviderHeaders | Promise<ProviderHeaders>;
}
export type ModelsApiStreamOptions<TApi extends Api> = ApiStreamOptions<TApi> & ModelsRequestTransforms;
export type ModelsSimpleStreamOptions = SimpleStreamOptions & ModelsRequestTransforms;
export type ModelsDeferredFetchOptions = DeferredFetchOptions & ModelsRequestTransforms;
export type ModelsDeferredCancelOptions = DeferredCancelOptions & ModelsRequestTransforms;
export type ModelsImagesOptions = ImagesOptions & ModelsRequestTransforms;
export type ModelsClassifierOptions = ClassifierOptions & ModelsRequestTransforms;
/** Any model a provider with chat APIs `TApi` can list. */
type ProviderModel<TApi extends Api> = Model<TApi> | ImageModel<ImageApi> | ClassifierModel<ClassifierApi>;
/**
 * A provider is the concrete runtime unit. It owns id/name/base metadata,
 * auth methods, model listing, and the operations its models support
 * (streaming, image generation, classification).
 *
 * `TApi` lets concrete provider factories declare which chat APIs their models
 * use (e.g. `openaiProvider(): Provider<"openai-responses" | "openai-completions">`),
 * giving typed chat model lists to direct factory users. Other model types use
 * their operation-specific API unions. Inside a `Models` collection providers
 * are held as `Provider<Api>`.
 */
export interface Provider<TApi extends Api = Api> {
    readonly id: string;
    readonly name: string;
    readonly baseUrl?: string;
    readonly headers?: ProviderHeaders;
    /**
     * Required: at least one of `apiKey`/`oauth`. Every provider has auth
     * semantics — even providers with only ambient credentials (env vars, AWS
     * profiles, ADC files) and keyless local servers provide `apiKey` auth
     * whose `resolve()` reports whether the provider is configured.
     * `Models.getAuth()` returns undefined when the provider is unconfigured.
     */
    readonly auth: ProviderAuth;
    /**
     * Current known chat models, sync. Static providers return their catalog;
     * dynamic providers return the list as of the last `refreshModels()` (empty
     * before the first). Must not throw; `Models` treats a throwing
     * implementation as having no models.
     */
    getModels(): readonly Model<TApi>[];
    /**
     * Current known models of every type, sync, with the same contract as
     * `getModels()`. Providers with only chat models may omit it; `Models` then
     * uses `getModels()`. Model ids are unique within each type; one upstream
     * model may have separate entries for different operations.
     */
    getAllModels?(): readonly ProviderModel<TApi>[];
    /**
     * Dynamic providers only: restore `context.stored` and optionally fetch a newer list using
     * the effective credential. Implementations retain their previous list on failure, publish
     * persistence and synchronous state changes through `context.publish()`, and honor the
     * shared abort signal for blocking work.
     */
    refreshModels?(context: RefreshModelsContext): Promise<void>;
    /**
     * Optional provider policy for credential-specific model availability.
     * `getModels()` remains the complete synchronous chat catalog; `Models.getAvailable()`
     * applies this filter after confirming that provider auth is configured.
     */
    filterModels?(models: readonly Model<TApi>[], credential: Credential | undefined): readonly Model<TApi>[];
    /**
     * Optional credential-specific availability policy across every model type.
     * Without it, `Models.getAllAvailable()` applies `filterModels` to chat models
     * and keeps every other model.
     */
    filterAllModels?(models: readonly ProviderModel<TApi>[], credential: Credential | undefined): readonly ProviderModel<TApi>[];
    /** Stream a normalized transcript. `Models` normalizes the caller's `Context` before dispatching here. */
    stream<T extends TApi>(model: Model<T>, context: TranscriptContext, options?: ApiStreamOptions<T>): AssistantMessageEventStream;
    streamSimple(model: Model<TApi>, context: TranscriptContext, options?: SimpleStreamOptions): AssistantMessageEventStream;
    fetchDeferred?(model: Model<TApi>, handle: DeferredHandle, options?: DeferredFetchOptions): AssistantMessageEventStream;
    cancelDeferred?(model: Model<TApi>, handle: DeferredHandle, options?: DeferredCancelOptions): Promise<void>;
    /** Present when the provider supports dedicated image models. Never rejects. */
    generateImages?(model: ImageModel<ImageApi>, context: ImagesContext, options?: ImagesOptions): Promise<AssistantImages>;
    /** Present when the provider supports structured classifier models. Never rejects. */
    classify?(model: ClassifierModel<ClassifierApi>, context: ClassifierContext, options?: ClassifierOptions): Promise<ClassifierResult>;
}
/**
 * Runtime collection of providers plus auth application and request
 * convenience. Providers own request behavior; `Models` resolves auth and
 * delegates each request to the provider that owns the model.
 *
 * Read accessors come in three flavors: the unqualified ones (`getModels`,
 * `getModel`, `getAvailable`) return chat models, the `*OfType` accessors
 * return one model type, and `getAllModels`/`getAllAvailable` return every type.
 */
export interface Models {
    getProviders(): readonly Provider[];
    getProvider(id: string): Provider | undefined;
    /**
     * Sync read of last-known chat models from one provider or all providers.
     * Best-effort: a provider whose `getModels()` throws yields no models.
     */
    getModels(provider?: string): readonly Model<Api>[];
    /**
     * Sync runtime chat model lookup against last-known lists. Dynamic model lists
     * are typed as `Model<Api>`; narrow with the `hasApi()` type guard.
     */
    getModel(provider: string, id: string): Model<Api> | undefined;
    /** Sync read of last-known models of one type from one provider or all providers. */
    getModelsOfType<TType extends ModelType>(type: TType, provider?: string): readonly ModelTypeMap[TType][];
    /** Sync runtime lookup of a model of one type against last-known lists. */
    getModelOfType<TType extends ModelType>(type: TType, provider: string, id: string): ModelTypeMap[TType] | undefined;
    /** Sync read of last-known models of every type from one provider or all providers. */
    getAllModels(provider?: string): readonly AnyModel[];
    /**
     * Refresh selected configured dynamic providers concurrently (all when `providers` is omitted).
     * Provider errors and cancellation are returned without rejecting; static, unknown, and
     * unconfigured providers are skipped.
     */
    refresh(options?: ModelsRefreshOptions): Promise<ModelsRefreshResult>;
    /** Check whether a provider has complete auth configuration without refreshing OAuth. */
    checkAuth(providerId: string, options?: AuthOperationOptions): Promise<AuthCheck | undefined>;
    /** Return chat models whose providers have complete auth configuration. */
    getAvailable(providerId?: string, options?: AuthOperationOptions): Promise<readonly Model<Api>[]>;
    /** Return models of one type whose providers have complete auth configuration. */
    getAvailableOfType<TType extends ModelType>(type: TType, providerId?: string, options?: AuthOperationOptions): Promise<readonly ModelTypeMap[TType][]>;
    /** Return models of every type whose providers have complete auth configuration. */
    getAllAvailable(providerId?: string, options?: AuthOperationOptions): Promise<readonly AnyModel[]>;
    /**
     * Resolve provider-scoped auth by provider id, or provider auth plus static
     * model headers when passed a model. Includes a source label for status UI.
     * Resolves `undefined` when the provider is unknown or unconfigured.
     * Rejects with `ModelsError`: code "oauth" when a token refresh fails (the
     * stored credential is preserved for retry; re-login fixes it), code "auth"
     * when api-key resolution or the credential store fails. Request paths
     * surface rejections as stream errors.
     */
    getAuth(providerId: string, overrides?: AuthResolutionOverrides): Promise<AuthResult | undefined>;
    getAuth(model: AnyModel, overrides?: AuthResolutionOverrides): Promise<AuthResult | undefined>;
    /** Run a provider-owned login flow and persist its returned credential. */
    login(providerId: string, type: AuthType, interaction: AuthInteraction, options?: LoginOptions): Promise<Credential>;
    /** Remove the stored credential for a provider. */
    logout(providerId: string, options?: AuthOperationOptions): Promise<void>;
    stream<TApi extends Api>(model: Model<TApi>, context: Context, options?: ModelsApiStreamOptions<TApi>): AssistantMessageEventStream;
    complete<TApi extends Api>(model: Model<TApi>, context: Context, options?: ModelsApiStreamOptions<TApi>): Promise<AssistantMessage>;
    streamSimple(model: Model<Api>, context: Context, options?: ModelsSimpleStreamOptions): AssistantMessageEventStream;
    completeSimple(model: Model<Api>, context: Context, options?: ModelsSimpleStreamOptions): Promise<AssistantMessage>;
    streamDeferred(model: Model<Api>, handle: DeferredHandle, options?: ModelsDeferredFetchOptions): AssistantMessageEventStream;
    fetchDeferred(model: Model<Api>, handle: DeferredHandle, options?: ModelsDeferredFetchOptions): Promise<AssistantMessage>;
    cancelDeferred(model: Model<Api>, handle: DeferredHandle, options?: ModelsDeferredCancelOptions): Promise<void>;
    /**
     * Generate images through the owning provider with auth resolved like
     * `stream()`. Never rejects: unknown providers, unconfigured auth, and
     * providers without `generateImages` return an error `AssistantImages`.
     */
    generateImages(model: ImageModel<ImageApi>, context: ImagesContext, options?: ModelsImagesOptions): Promise<AssistantImages>;
    /** Classify structured state through the owning provider. Never rejects. */
    classify(model: ClassifierModel<ClassifierApi>, context: ClassifierContext, options?: ModelsClassifierOptions): Promise<ClassifierResult>;
}
export interface MutableModels extends Models {
    /** Upsert/replace by provider.id. Provider ids are unique. */
    setProvider(provider: Provider): void;
    deleteProvider(id: string): void;
    clearProviders(): void;
}
export interface CreateModelsOptions {
    credentials?: CredentialStore;
    modelsStore?: ModelsStore;
    authContext?: AuthContext;
}
export declare function createModels(options?: CreateModelsOptions): MutableModels;
export interface CreateProviderOptions<TApi extends Api = Api> {
    id: string;
    /** Display name. Default: `id`. */
    name?: string;
    baseUrl?: string;
    headers?: ProviderHeaders;
    /** Required — every provider has auth semantics, even ambient/keyless ones. */
    auth: ProviderAuth;
    /**
     * Static baseline models of every type (empty for purely dynamic providers).
     * Models without `type` are chat models.
     */
    models: readonly ProviderModel<TApi>[];
    /**
     * Fetch a dynamic model overlay of every type. createProvider restores and
     * publishes it transactionally and drops models of unknown types.
     */
    fetchModels?: (context: RefreshModelsContext) => Promise<readonly ProviderModel<TApi>[]>;
    /** Credential-specific chat model availability. See `Provider.filterModels`. */
    filterModels?: (models: readonly Model<TApi>[], credential: Credential | undefined) => readonly Model<TApi>[];
    /** Credential-specific availability across every model type. See `Provider.filterAllModels`. */
    filterAllModels?: (models: readonly ProviderModel<TApi>[], credential: Credential | undefined) => readonly ProviderModel<TApi>[];
    /**
     * Chat implementation: a single one for all chat models, or a map keyed by
     * `model.api` for mixed-API providers. Optional when `images` or
     * `classifiers` is given.
     */
    api?: ProviderStreams | Partial<Record<TApi, ProviderStreams>>;
    /** Image-generation implementations keyed by `model.api`. */
    images?: Partial<Record<ImageApi, ProviderImages>>;
    /** Classifier implementations keyed by `model.api`. */
    classifiers?: Partial<Record<ClassifierApi, ProviderClassifier>>;
}
/**
 * Builds a provider from parts. Built-in provider factories and models.json
 * custom providers both go through this. A single `api` streams all chat
 * models; an `api` map dispatches on `model.api`, and a model whose api has
 * no entry produces a stream error. One-shot operation maps dispatch on
 * `model.api` the same way. At least one concrete implementation across
 * `api`/`images`/`classifiers` is required; empty maps are rejected.
 */
export declare function createProvider<TApi extends Api = Api>(input: CreateProviderOptions<TApi>): Provider<TApi>;
/**
 * Runtime-checked narrowing for dynamically looked-up models:
 *
 * ```ts
 * const model = models.getModel("anthropic", "claude-opus-4-7");
 * if (model && hasApi(model, "anthropic-messages")) {
 *   // model: Model<"anthropic-messages">, stream options fully typed
 * }
 * ```
 *
 * Non-chat models never match, even when their api id equals `api`.
 */
export declare function hasApi<TApi extends Api>(model: AnyModel, api: TApi): model is Model<TApi>;
export declare function calculateCost(model: AnyModel, usage: Usage): Usage["cost"];
export declare function getThinkingOptions<TApi extends Api>(model: Model<TApi>): ThinkingOption[];
export declare function getSupportedThinkingLevels<TApi extends Api>(model: Model<TApi>): ModelThinkingLevel[];
export declare function clampThinkingLevel<TApi extends Api>(model: Model<TApi>, level: ModelThinkingLevel): ModelThinkingLevel;
/**
 * Check if two models are equal by comparing their type, id, and provider.
 * Returns false if either model is null or undefined.
 */
export declare function modelsAreEqual(a: AnyModel | null | undefined, b: AnyModel | null | undefined): boolean;
//# sourceMappingURL=models.d.ts.map
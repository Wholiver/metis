import type { KnownProvider, ProviderEnv } from "./types.ts";
export declare const ANTHROPIC_AUTH_TOKEN_ENV = "ANTHROPIC_AUTH_TOKEN";
export declare const ANTHROPIC_OAUTH_TOKEN_ENV = "ANTHROPIC_OAUTH_TOKEN";
export declare const ANTHROPIC_API_KEY_ENV = "ANTHROPIC_API_KEY";
export declare const ANTHROPIC_FEDERATION_RULE_ID_ENV = "ANTHROPIC_FEDERATION_RULE_ID";
export declare const ANTHROPIC_ORGANIZATION_ID_ENV = "ANTHROPIC_ORGANIZATION_ID";
export declare const ANTHROPIC_SERVICE_ACCOUNT_ID_ENV = "ANTHROPIC_SERVICE_ACCOUNT_ID";
export declare const ANTHROPIC_IDENTITY_TOKEN_FILE_ENV = "ANTHROPIC_IDENTITY_TOKEN_FILE";
export declare const ANTHROPIC_WORKSPACE_ID_ENV = "ANTHROPIC_WORKSPACE_ID";
/**
 * Find configured environment variables that can provide an API key for a provider.
 *
 * This only reports actual API key variables. It intentionally excludes ambient
 * credential sources such as AWS profiles, AWS IAM credentials, and Google
 * Application Default Credentials.
 */
export declare function findEnvKeys(provider: KnownProvider, env?: ProviderEnv): string[] | undefined;
export declare function findEnvKeys(provider: string, env?: ProviderEnv): string[] | undefined;
/**
 * Get API key for provider from known environment variables, e.g. OPENAI_API_KEY.
 *
 * Will not return API keys for providers that require OAuth tokens.
 */
export declare function getEnvApiKey(provider: KnownProvider, env?: ProviderEnv): string | undefined;
export declare function getEnvApiKey(provider: string, env?: ProviderEnv): string | undefined;
//# sourceMappingURL=env-api-keys.d.ts.map
import type { ProviderEnv } from "../types.ts";
export { ModelsError, type ModelsErrorCode } from "../utils/models-error.ts";
import type { AuthContext, AuthResult, CredentialStore, OAuthAuth, OAuthCredential, ProviderAuth } from "./types.ts";
export interface AuthResolutionOverrides {
    apiKey?: string;
    env?: ProviderEnv;
    /** Require this much remaining OAuth-token validity; defaults to five minutes. */
    minOAuthValidityMs?: number;
    signal?: AbortSignal;
}
/**
 * Auth resolution shared by all operations in a `Models` collection.
 * A stored credential owns the provider: ambient/env is consulted only when
 * nothing is stored. No silent env fallback after a failed refresh or for a
 * credential type without a matching handler.
 */
export declare function resolveProviderAuth(provider: {
    id: string;
    auth: ProviderAuth;
}, credentials: CredentialStore, authContext: AuthContext, overrides?: AuthResolutionOverrides): Promise<AuthResult | undefined>;
/**
 * Refresh a stored OAuth credential under the credential-store lock and persist
 * the result before the lock is released. `needsRefresh` is re-checked under
 * the lock, so concurrent callers and processes refresh only once.
 *
 * `signal` cancels only the wait for the lock. Once a refresh starts, the
 * provider may already have rotated the refresh token, so the refresh and its
 * persistence ignore `signal` and are bounded only by a timeout. Otherwise a
 * cancelled caller could discard the only valid refresh token. Callers that
 * must return promptly on cancellation race this promise with their signal.
 *
 * Resolves with the stored OAuth credential after the operation, or undefined
 * when the provider no longer has an OAuth credential.
 */
export declare function refreshStoredOAuthCredential(credentials: CredentialStore, providerId: string, oauth: OAuthAuth, needsRefresh: (credential: OAuthCredential) => boolean, signal: AbortSignal): Promise<OAuthCredential | undefined>;
//# sourceMappingURL=resolve.d.ts.map
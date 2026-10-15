/**
 * Loopback OAuth redirect handler shared by the browser sign-in flows.
 *
 * NOTE: This module uses node:http. It is only reachable through the lazily
 * loaded OAuth flow modules, never from browser-facing entry points.
 */
import type { ProviderAuthInteraction } from "../types.ts";
export interface OAuthCallbackServerOptions<T> {
    /** Provider name used on the browser page, for example `OpenAI`. */
    providerName: string;
    /** Address to listen on. */
    host: string;
    /** Port to listen on; `0` picks a free port. */
    port: number;
    path: string;
    /** Host in `redirectUri` when it differs from `host`, for example `localhost`. */
    redirectHost?: string;
    /** Expected `state` parameter. Omit when the provider does not send one. */
    state?: string;
    /**
     * Finishes the sign-in with the received code before the browser page is sent, so the page can
     * show exchange failures. Pass `async (code) => code` to exchange the code later.
     */
    complete: (code: string) => Promise<T>;
    signal?: AbortSignal;
    timeoutMs?: number;
}
export interface OAuthCallbackServer<T> {
    redirectUri: string;
    /**
     * Resolves with the result of `complete`, or `undefined` after `cancel()`. Rejects when the provider
     * redirects with an error, `complete` fails, the signal aborts, or the timeout elapses.
     */
    wait(): Promise<T | undefined>;
    /** Stop waiting for the browser unless a callback is already being completed. */
    cancel(): void;
    close(): void;
}
export declare function startOAuthCallbackServer<T>(options: OAuthCallbackServerOptions<T>): Promise<OAuthCallbackServer<T>>;
/**
 * Wait for the browser callback, or for the user to paste the code or redirect URL when the browser
 * cannot reach the loopback server (for example over SSH). Without a callback server only the manual
 * prompt is used.
 */
export declare function waitForCallbackOrManualInput<T>(interaction: ProviderAuthInteraction, callback: OAuthCallbackServer<T> | undefined, prompt: {
    message: string;
    placeholder: string;
}): Promise<{
    type: "callback";
    value: T;
} | {
    type: "manual";
    input: string;
}>;
//# sourceMappingURL=callback-server.d.ts.map
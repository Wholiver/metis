/**
 * Loopback OAuth redirect handler shared by the browser sign-in flows.
 *
 * NOTE: This module uses node:http. It is only reachable through the lazily
 * loaded OAuth flow modules, never from browser-facing entry points.
 */
import { createServer } from "node:http";
import { oauthErrorHtml, oauthSuccessHtml } from "../../utils/oauth-page.js";
function sendPage(response, status, html) {
    response.writeHead(status, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    response.end(html);
}
export async function startOAuthCallbackServer(options) {
    const { providerName, signal } = options;
    if (signal?.aborted)
        throw new Error("Login cancelled");
    let resolveWait = () => { };
    let rejectWait = () => { };
    const waitPromise = new Promise((resolve, reject) => {
        resolveWait = resolve;
        rejectWait = reject;
    });
    // A cancelled or closed wait may never be observed.
    waitPromise.catch(() => undefined);
    let claimed = false;
    let settled = false;
    let timer;
    const onAbort = () => finish({ error: new Error("Login cancelled") });
    const finish = (result) => {
        if (settled)
            return;
        settled = true;
        if (timer)
            clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        if ("error" in result)
            rejectWait(result.error);
        else
            resolveWait(result.value);
    };
    const server = createServer((request, response) => {
        void (async () => {
            const url = new URL(request.url ?? "/", "http://localhost");
            if (request.method !== "GET" || url.pathname !== options.path) {
                sendPage(response, 404, oauthErrorHtml("Callback route not found."));
                return;
            }
            if (options.state !== undefined && url.searchParams.get("state") !== options.state) {
                sendPage(response, 400, oauthErrorHtml("State mismatch."));
                return;
            }
            if (claimed || settled) {
                sendPage(response, 409, oauthErrorHtml("This sign-in has already been handled."));
                return;
            }
            const error = url.searchParams.get("error");
            if (error) {
                const description = url.searchParams.get("error_description") ?? error;
                sendPage(response, 400, oauthErrorHtml(`${providerName} authorization failed.`, description));
                finish({ error: new Error(`${providerName} authorization failed: ${description}`) });
                return;
            }
            const code = url.searchParams.get("code");
            if (!code) {
                sendPage(response, 400, oauthErrorHtml("Missing authorization code."));
                return;
            }
            claimed = true;
            try {
                const value = await options.complete(code);
                sendPage(response, 200, oauthSuccessHtml(`Signed in to ${providerName}. You may now close this page.`));
                finish({ value });
            }
            catch (error) {
                const failure = error instanceof Error ? error : new Error(String(error));
                sendPage(response, 502, oauthErrorHtml(`${providerName} sign-in failed.`, failure.message));
                finish({ error: failure });
            }
        })();
    });
    await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(options.port, options.host, () => {
            server.off("error", reject);
            resolve();
        });
    });
    const address = server.address();
    if (!address || typeof address === "string") {
        server.close();
        throw new Error("OAuth callback server did not bind to TCP");
    }
    server.on("error", (error) => finish({ error }));
    signal?.addEventListener("abort", onAbort, { once: true });
    if (options.timeoutMs !== undefined) {
        timer = setTimeout(() => finish({ error: new Error(`${providerName} sign-in timed out`) }), options.timeoutMs);
    }
    const redirectHost = options.redirectHost ?? options.host;
    return {
        redirectUri: `http://${redirectHost.includes(":") ? `[${redirectHost}]` : redirectHost}:${address.port}${options.path}`,
        wait: () => waitPromise,
        cancel: () => {
            if (!claimed)
                finish({ value: undefined });
        },
        close: () => {
            finish({ error: new Error("OAuth callback server closed") });
            server.close();
        },
    };
}
/**
 * Wait for the browser callback, or for the user to paste the code or redirect URL when the browser
 * cannot reach the loopback server (for example over SSH). Without a callback server only the manual
 * prompt is used.
 */
export async function waitForCallbackOrManualInput(interaction, callback, prompt) {
    const manualAbort = new AbortController();
    let manualError;
    const manual = interaction
        .prompt({ type: "manual_code", ...prompt, signal: manualAbort.signal })
        .then((input) => {
        callback?.cancel();
        return input;
    })
        .catch((error) => {
        manualError = error instanceof Error ? error : new Error(String(error));
        callback?.cancel();
        return undefined;
    });
    try {
        const value = await callback?.wait();
        if (manualError)
            throw manualError;
        if (value !== undefined)
            return { type: "callback", value };
        const input = await manual;
        if (manualError)
            throw manualError;
        return { type: "manual", input: input ?? "" };
    }
    finally {
        manualAbort.abort();
    }
}
//# sourceMappingURL=callback-server.js.map
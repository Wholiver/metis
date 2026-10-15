/**
 * Meta Model API OAuth flow
 *
 * RFC 8628 device authorization grant against https://auth.meta.com (JSON
 * responses). Meta splits identity from API access: the resulting identity
 * token is not accepted for inference, so it is exchanged for a Model API
 * key via the Muse Code key-mint endpoint (minted keys live about a day).
 * The identity token is stored as `refresh` and the minted key as `access`,
 * so the standard OAuth scheduler re-mints the key when it expires with no
 * bespoke renewal machinery. The identity token itself is not renewable
 * (auth.meta.com answers grant_type=refresh_token with 404 and issues no
 * refresh_token), so a 401/403 from mint means the session is dead and the
 * user must sign in again.
 */
import type { OAuthAuth } from "../types.ts";
export declare const metaOAuth: OAuthAuth;
//# sourceMappingURL=meta.d.ts.map
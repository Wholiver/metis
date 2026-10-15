import type { ProviderHeaders } from "../types.ts";
export declare function headersToRecord(headers: Headers): Record<string, string>;
export declare function providerHeadersToRecord(...headerSources: (ProviderHeaders | undefined)[]): Record<string, string> | undefined;
//# sourceMappingURL=headers.d.ts.map
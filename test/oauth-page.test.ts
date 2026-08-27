import { describe, expect, it } from "vitest";
import { oauthErrorHtml, oauthSuccessHtml } from "../vendor/metis-ai/dist/utils/oauth/oauth-page.js";

describe("OAuth callback page", () => {
	it("renders a green circle with a white checkmark after successful authentication", () => {
		const html = oauthSuccessHtml("Authentication completed.");

		expect(html).toContain("<title>Metis · Authentication successful</title>");
		expect(html).toContain('<div class="brand">Metis</div>');
		expect(html).toContain('<circle cx="36" cy="36" r="36" fill="#22c55e"/>');
		expect(html).toContain('stroke="#fff"');
		expect(html).not.toContain("M165.29 165.29");
	});

	it("renders a red circle with a white cross after failed authentication", () => {
		const html = oauthErrorHtml("Authentication failed.");

		expect(html).toContain("<title>Metis · Authentication failed</title>");
		expect(html).toContain('<div class="brand">Metis</div>');
		expect(html).toContain('<circle cx="36" cy="36" r="36" fill="#ef4444"/>');
		expect(html).toContain('d="m24 24 24 24M48 24 24 48"');
		expect(html).toContain('stroke="#fff"');
		expect(html).not.toContain("M165.29 165.29");
	});
});


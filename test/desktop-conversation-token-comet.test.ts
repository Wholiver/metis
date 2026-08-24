import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const comet = require("../desktop/renderer/conversation-token-comet.js") as {
	conversationTokenTotal: (messages: unknown[]) => number;
	tokenTrailMetrics: (tokens: number) => { band: string; width: number };
	usageTokenTotal: (usage: unknown) => number;
};

describe("desktop conversation token comet", () => {
	it("totals assistant usage locally without double-counting native totals", () => {
		expect(comet.usageTokenTotal({
			totalTokens: 120,
			input: 80,
			output: 20,
			cacheRead: 15,
			cacheWrite: 5,
		})).toBe(120);
		expect(comet.conversationTokenTotal([
			{ role: "user", usage: { totalTokens: 999 } },
			{ role: "assistant", usage: { totalTokens: 120 } },
			{ role: "assistant", usage: { input: 40, output: 10, cacheRead: 5, cacheWrite: 2 } },
			{ role: "assistant", usage: { totalTokens: Number.NaN } },
		])).toBe(177);
	});

	it("maps token totals continuously across short, medium, and long widths", () => {
		expect(comet.tokenTrailMetrics(0)).toEqual({ band: "short", width: 30 });
		expect(comet.tokenTrailMetrics(1_000).width).toBeCloseTo(49, 0);
		expect(comet.tokenTrailMetrics(10_000).width).toBeCloseTo(84, 0);
		expect(comet.tokenTrailMetrics(100_000).width).toBeCloseTo(123, 0);
		expect(comet.tokenTrailMetrics(1_000_000)).toEqual({ band: "short", width: 164 });
		expect(comet.tokenTrailMetrics(3_000_000)).toEqual({ band: "medium", width: 184.5 });
		expect(comet.tokenTrailMetrics(5_000_000)).toEqual({ band: "medium", width: 205 });
		expect(comet.tokenTrailMetrics(17_500_000)).toEqual({ band: "long", width: 223.5 });
		expect(comet.tokenTrailMetrics(30_000_000)).toEqual({ band: "long", width: 242 });
		expect(comet.tokenTrailMetrics(80_000_000).width).toBeCloseTo(267.71, 2);
		expect(comet.tokenTrailMetrics(100_000_000)).toEqual({ band: "long", width: 278 });
		expect(comet.tokenTrailMetrics(200_000_000)).toEqual({ band: "long", width: 278 });
	});

	it("reserves visible width changes across the long-token range", () => {
		const widths = [30_000_000, 50_000_000, 80_000_000, 100_000_000]
			.map((tokens) => comet.tokenTrailMetrics(tokens).width);
		for (let index = 1; index < widths.length; index += 1) {
			expect(widths[index] - widths[index - 1]).toBeGreaterThan(10);
		}
		expect(widths.at(-1)! - widths[0]).toBe(36);
	});

	it("allocates clear visual steps to low token totals without widening the sidebar", () => {
		const widths = [0, 1_000, 10_000, 100_000, 1_000_000]
			.map((tokens) => comet.tokenTrailMetrics(tokens).width);
		for (let index = 1; index < widths.length; index += 1) {
			expect(widths[index] - widths[index - 1]).toBeGreaterThan(12);
		}
		expect(Math.max(...widths)).toBeLessThanOrEqual(278);
	});

	it("renders a CSS-only purple trail after each title and keeps accounting local", () => {
		const html = readFileSync(resolve(process.cwd(), "desktop/renderer/index.html"), "utf8");
		const app = readFileSync(resolve(process.cwd(), "desktop/renderer/app.js"), "utf8");
		const helper = readFileSync(resolve(process.cwd(), "desktop/renderer/conversation-token-comet.js"), "utf8");
		const styles = readFileSync(resolve(process.cwd(), "desktop/renderer/styles.css"), "utf8");
		expect(html).not.toContain('id="conversationTokenComet"');
		expect(html).toContain('<script src="conversation-token-comet.js"></script>');
		expect(app).toContain("conversationTokenComet.conversationTokenTotal(state.messages)");
		expect(app).toContain('trail.className = "conversation-token-trail"');
		expect(app).toContain('trail.dataset.renderer = "css-gradient"');
		expect(app).not.toContain("trail.append(createConversationTokenTrailSvg(conversationId, working))");
		expect(app).not.toContain('conversation-token-trail-pixel');
		expect(app).not.toContain('conversation-token-trail-canvas');
		expect(app).not.toContain("createConversationTokenTrailCanvasLegacy");
		expect(app).not.toContain("randomConversationTokenTrailParticle");
		expect(app).not.toContain("drawConversationTokenTrail");
		expect(app).not.toContain("scheduleConversationTokenTrailAnimation");
		expect(app).not.toContain("new IntersectionObserver");
		expect(app).not.toContain("new ResizeObserver");
		expect(app).toMatch(/if \(conversationTokenComet && !isUntitled\) \{[\s\S]*?button\.classList\.add\("has-token-trail"\)/);
		expect(app).toContain('conversation.title === uiText("untitledTask") || isNaming');
		expect(app).not.toContain("if (isActive && conversationTokenComet)");
		expect(app).not.toMatch(/for \(let row = 0; row < 5; row \+= 1\)/);
		expect(app).toMatch(/button\.append\(label\);[\s\S]*?tokenTrail = createConversationTokenTrail\(conversation\.tokenTotal,[\s\S]*?button\.append\(tokenTrail\);[\s\S]*?const right/);
		expect(app).not.toMatch(/setStreamingState\(true, uiText\("switchingSession"\)\)/);
		expect(app).not.toMatch(/setStreamingState\(true, uiText\("creatingTask"\)\)/);
		expect(app).not.toMatch(/setStreamingState\(true, uiText\("switchingProject"\)\)/);
		expect(app).not.toContain("tokenCometWorking");
		expect(helper).not.toMatch(/fetch\(|requestServer|metisDesktop/);
		expect(app).toContain("desktop.sessionTokens.totals(sessionPaths)");
		expect(styles).toContain("transparent 0");
		expect(styles).toContain("rgb(215 215 215 / 0.018) 14px");
		expect(styles).toContain("rgb(212 200 221 / 0.075) 38px");
		expect(styles).toContain("rgb(184 155 209 / 0.18) 72px");
		expect(styles).toContain("rgb(152 91 197 / 0.20) 100%");
		expect(styles).toContain("rgb(0 0 0 / 0.62) 46px");
		expect(styles).toContain("#000 82px");
		expect(styles).toMatch(/conversation-token-trail[\s\S]*?mask-image:\s*linear-gradient/);
		expect(styles).toMatch(/conversation-title-shield[\s\S]*?text-shadow|text-shadow:[\s\S]*?conversation-title-shield/);
		expect(styles).not.toContain("conversation-token-trail-canvas");
		expect(styles).toMatch(/transition-property:\s*width/);
		expect(styles).toMatch(/\.conversation-token-trail\s*\{[\s\S]*?position:\s*absolute;[\s\S]*?inset:\s*0 0 0 auto;[\s\S]*?height:\s*100%/);
		expect(styles).toMatch(/\[data-purpose="channel-list"\] \.conversation-token-trail\s*\{[\s\S]*?rgb\(120 120 120 \/ 0\.14\)/);
		expect(styles).toMatch(/\[data-purpose="channel-list"\] \.conversation-item\.active \.conversation-token-trail\s*\{[\s\S]*?rgb\(152 91 197 \/ 0\.20\)/);
		expect(styles).toMatch(/\.conversation-item\.has-token-trail\s*\{[\s\S]*?overflow:\s*hidden/);
		expect(app).not.toContain("conversationTokenTrailSvg");
		expect(app).not.toContain("TOKEN_TRAIL_SVG");
		expect(styles).not.toContain("conversation-token-trail-svg");
		expect(styles).not.toContain(".conversation-token-comet");
		expect(styles).not.toMatch(/conversation-token-trail::after/);
		expect(styles).toContain("content-visibility: auto");
		expect(styles).toContain("contain-intrinsic-size: auto 38px");
	});
});

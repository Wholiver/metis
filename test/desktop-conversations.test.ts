import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { isSubagentSession, restoreProjectState, serializeProjectState, visibleProjectConversations, visibleSessions } = require("../desktop/renderer/conversations.js") as {
	isSubagentSession: (session: unknown) => boolean;
	restoreProjectState: (serialized: unknown, fallback: { name: string; path: string }) => {
		activeProjectId?: string;
		projects: Array<{ id: string; name: string; path: string; conversations: unknown[]; lastSessionPath?: string }>;
	};
	serializeProjectState: (projects: unknown[], activeProjectId?: string) => string;
	visibleProjectConversations: <T>(conversations: T[], expanded?: boolean, limit?: number) => T[];
	visibleSessions: (sessions: unknown[]) => unknown[];
};

describe("desktop conversation visibility", () => {
	it("hides current and legacy subagent session logs", () => {
		const current = { id: "current", firstMessage: '<file name="/workspace/.metis-subagent-abc123.txt">\n[SUBAGENT TASK]\nResearch' };
		const legacy = { id: "legacy", firstMessage: '<file name="/workspace/.metis-subagent-def456.txt">\nResearch' };
		const normal = { id: "normal", firstMessage: "Research normally" };

		expect(isSubagentSession(current)).toBe(true);
		expect(isSubagentSession(legacy)).toBe(true);
		expect(visibleSessions([current, legacy, normal])).toEqual([normal]);
	});
});

describe("desktop project persistence", () => {
	it("shows five conversations by default and all after expansion", () => {
		const conversations = Array.from({ length: 7 }, (_, index) => ({ id: String(index) }));

		expect(visibleProjectConversations(conversations)).toEqual(conversations.slice(0, 5));
		expect(visibleProjectConversations(conversations, true)).toEqual(conversations);
	});

	it("keeps added workspaces as separate project nodes", () => {
		const serialized = serializeProjectState([
			{ id: "one", name: "metis_v2", path: "/work/metis_v2", collapsed: false, lastSessionPath: "/sessions/one.jsonl" },
			{ id: "two", name: "second", path: "/work/second", collapsed: true },
		], "two");
		const restored = restoreProjectState(serialized, { name: "metis_v2", path: "/work/metis_v2" });

		expect(restored.activeProjectId).toBe("two");
		expect(restored.projects.map((project) => project.path)).toEqual(["/work/metis_v2", "/work/second"]);
		expect(restored.projects[0]?.lastSessionPath).toBe("/sessions/one.jsonl");
		expect(restored.projects.every((project) => project.conversations.length === 0)).toBe(true);
	});

	it("deduplicates fallback workspace instead of replacing saved projects", () => {
		const restored = restoreProjectState({
			projects: [
				{ id: "one", name: "metis_v2", path: "/work/metis_v2" },
				{ id: "duplicate", name: "duplicate", path: "/work/metis_v2/" },
			],
			activeProjectId: "one",
		}, { name: "metis_v2", path: "/work/metis_v2" });

		expect(restored.projects).toHaveLength(1);
		expect(restored.projects[0]?.id).toBe("one");
	});
});

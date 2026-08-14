import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { fromSessions, isSubagentSession, restoreProjectState, serializeProjectState, sortConversationsByCreatedAt, visibleSessions } = require("../desktop/renderer/conversations.js") as {
	fromSessions: (sessions: unknown[], untitledTitle: string) => Array<{
		id: string;
		title: string;
		branch: boolean;
		sessionPath?: string;
		createdAt?: string;
		updatedAt?: string;
	}>;
	isSubagentSession: (session: unknown) => boolean;
	restoreProjectState: (serialized: unknown, fallback: { name: string; path: string }) => {
		activeProjectId?: string;
		projects: Array<{ id: string; name: string; displayName?: string; accentColor?: string; path: string; conversations: unknown[]; lastSessionPath?: string }>;
	};
	serializeProjectState: (projects: unknown[], activeProjectId?: string) => string;
	sortConversationsByCreatedAt: <T>(conversations: T[]) => T[];
	visibleSessions: (sessions: unknown[]) => unknown[];
};

describe("desktop conversation visibility", () => {
	it("maps the server session-list response into clickable conversations", () => {
		const conversations = fromSessions([
			{
				id: "session-id",
				path: "/sessions/session-id.jsonl",
				name: "Saved conversation",
				firstMessage: "Original prompt",
				parentSessionPath: "/sessions/parent.jsonl",
			},
		], "Untitled");

		expect(conversations).toEqual([
			{
				id: "/sessions/session-id.jsonl",
				title: "Saved conversation",
				branch: true,
				sessionPath: "/sessions/session-id.jsonl",
			},
		]);
	});

	it("sorts conversations by creation time instead of modified time", () => {
		const conversations = fromSessions([
			{
				id: "older-opened-now",
				path: "/sessions/older.jsonl",
				name: "Older, recently opened",
				created: "2026-08-01T10:00:00.000Z",
				modified: "2026-08-09T10:00:00.000Z",
			},
			{
				id: "newer",
				path: "/sessions/newer.jsonl",
				name: "Newer",
				created: "2026-08-08T10:00:00.000Z",
				modified: "2026-08-08T10:00:00.000Z",
			},
		], "Untitled");

		expect(conversations.map((conversation) => conversation.id)).toEqual([
			"/sessions/newer.jsonl",
			"/sessions/older.jsonl",
		]);
		expect(conversations[1]?.updatedAt).toBe("2026-08-09T10:00:00.000Z");
	});

	it("keeps creation-time ties stable", () => {
		const conversations = [
			{ id: "first", createdAt: "2026-08-08T10:00:00.000Z" },
			{ id: "second", createdAt: "2026-08-08T10:00:00.000Z" },
		];

		expect(sortConversationsByCreatedAt(conversations).map((conversation) => conversation.id)).toEqual(["first", "second"]);
	});

	it("hides current and legacy subagent session logs", () => {
		const current = { id: "current", firstMessage: '<file name="/workspace/.metis-subagent-abc123.txt">\n[SUBAGENT TASK]\nResearch' };
		const legacy = { id: "legacy", firstMessage: '<file name="/workspace/.metis-subagent-def456.txt">\nResearch' };
		const normal = { id: "normal", firstMessage: "Research normally" };

		expect(isSubagentSession(current)).toBe(true);
		expect(isSubagentSession(legacy)).toBe(true);
		expect(visibleSessions([current, legacy, normal])).toEqual([normal]);
	});

	it("hides current and legacy Dream background sessions", () => {
		const current = { id: "current", firstMessage: "[BACKGROUND DREAM TASK]\nExplore" };
		const legacy = { id: "legacy", firstMessage: "[BACKGROUND DREAM PHASE TASK]\nExplore" };
		const normal = { id: "normal", firstMessage: "Explore normally" };

		expect(visibleSessions([current, legacy, normal])).toEqual([normal]);
	});
});

describe("desktop project persistence", () => {
	it("ignores legacy conversation-collapse state", () => {
		const restored = restoreProjectState({
			projects: [{ id: "one", name: "metis_v2", path: "/work/metis_v2", conversationsExpanded: false }],
		}, { name: "metis_v2", path: "/work/metis_v2" });
		const serialized = serializeProjectState(restored.projects, restored.activeProjectId);

		expect(restored.projects[0]).not.toHaveProperty("conversationsExpanded");
		expect(serialized).not.toContain("conversationsExpanded");
	});

	it("keeps added workspaces as separate project nodes", () => {
		const serialized = serializeProjectState([
			{
				id: "one",
				name: "metis_v2",
				path: "/work/metis_v2",
				collapsed: false,
				lastSessionPath: "/sessions/one.jsonl",
				conversations: [{ id: "/sessions/one.jsonl", title: "Saved conversation", branch: false, sessionPath: "/sessions/one.jsonl" }],
			},
			{ id: "two", name: "second", path: "/work/second", collapsed: true },
		], "two");
		const restored = restoreProjectState(serialized, { name: "metis_v2", path: "/work/metis_v2" });

		expect(restored.activeProjectId).toBe("two");
		expect(restored.projects.map((project) => project.path)).toEqual(["/work/metis_v2", "/work/second"]);
		expect(restored.projects[0]?.lastSessionPath).toBe("/sessions/one.jsonl");
		expect(restored.projects[0]?.conversations).toEqual([
			{ id: "/sessions/one.jsonl", title: "Saved conversation", branch: false, sessionPath: "/sessions/one.jsonl" },
		]);
		expect(restored.projects[1]?.conversations).toEqual([]);
	});

	it("persists Desktop-only project appearance without changing workspace identity", () => {
		const serialized = serializeProjectState([{
			id: "one",
			name: "metis_v2",
			displayName: "Metis Lab",
			accentColor: "#6FA8EE",
			path: "/work/metis_v2",
		}], "one");
		const restored = restoreProjectState(serialized, { name: "metis_v2", path: "/work/metis_v2" });

		expect(restored.projects[0]).toMatchObject({
			name: "metis_v2",
			displayName: "Metis Lab",
			accentColor: "#6fa8ee",
			path: "/work/metis_v2",
		});
	});

	it("drops malformed project appearance values", () => {
		const restored = restoreProjectState({
			projects: [{ name: "metis_v2", displayName: "   ", accentColor: "red", path: "/work/metis_v2" }],
		}, { name: "metis_v2", path: "/work/metis_v2" });

		expect(restored.projects[0]).not.toHaveProperty("displayName");
		expect(restored.projects[0]).not.toHaveProperty("accentColor");
	});

	it("drops malformed cached conversations without losing valid history", () => {
		const restored = restoreProjectState({
			projects: [{
				id: "one",
				name: "metis_v2",
				path: "/work/metis_v2",
				conversations: [
					{ id: "/sessions/one.jsonl", title: "Saved conversation", branch: true, sessionPath: "/sessions/one.jsonl" },
					{ id: "/sessions/one.jsonl", title: "Duplicate" },
					{ id: "", title: "Missing identity" },
					{ id: "/sessions/two.jsonl", title: "" },
				],
			}],
		}, { name: "metis_v2", path: "/work/metis_v2" });

		expect(restored.projects[0]?.conversations).toEqual([
			{ id: "/sessions/one.jsonl", title: "Saved conversation", branch: true, sessionPath: "/sessions/one.jsonl" },
		]);
	});

	it("uses the current workspace when no project state has been saved", () => {
		const restored = restoreProjectState(undefined, { name: "metis_v2", path: "/work/metis_v2" });

		expect(restored.activeProjectId).toBe("workspace:%2Fwork%2Fmetis_v2");
		expect(restored.projects).toMatchObject([
			{ id: "workspace:%2Fwork%2Fmetis_v2", name: "metis_v2", path: "/work/metis_v2", conversations: [] },
		]);
	});

	it("appends the current workspace without replacing saved projects", () => {
		const restored = restoreProjectState({
			projects: [{ id: "one", name: "first", path: "/work/first" }],
			activeProjectId: "one",
		}, { name: "second", path: "/work/second" });

		expect(restored.activeProjectId).toBe("one");
		expect(restored.projects.map((project) => project.path)).toEqual(["/work/first", "/work/second"]);
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

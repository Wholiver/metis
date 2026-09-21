import { describe, expect, it } from "vitest";
import {
	classifyProgressTool,
	formatProgressNudge,
	PROGRESS_NUDGE_MARKER,
	resolveProgressNudge,
	type ProgressHistoryMessage,
	type ProgressToolResult,
} from "../src/core/progress-narration.ts";

function user(text: string): ProgressHistoryMessage {
	return { role: "user", content: [{ type: "text", text }] };
}

function assistant(text: string, tools: Array<{ id: string; name: string; arguments?: Record<string, unknown> }> = []): ProgressHistoryMessage {
	return {
		role: "assistant",
		content: [
			...(text ? [{ type: "text", text }] : []),
			...tools.map((tool) => ({ type: "toolCall", id: tool.id, name: tool.name, arguments: tool.arguments ?? {} })),
		],
	};
}

function toolResult(id: string, name: string, isError = false): ProgressHistoryMessage & ProgressToolResult {
	return { role: "toolResult", toolCallId: id, toolName: name, isError };
}

function context(content: string): ProgressHistoryMessage {
	return { role: "custom", customType: "workflow_context", content };
}

describe("classifyProgressTool", () => {
	it("maps explore, admit, mutate, verify, and delegate tools", () => {
		expect(classifyProgressTool("ls")).toBe("explore");
		expect(classifyProgressTool("read_plan")).toBe("explore");
		expect(classifyProgressTool("query_memory_db")).toBe("explore");
		expect(classifyProgressTool("browser_snapshot")).toBe("explore");
		expect(classifyProgressTool("browser_navigate")).toBe("mutate");
		expect(classifyProgressTool("browser_tabs", { action: "list" })).toBe("explore");
		expect(classifyProgressTool("browser_tabs", { action: "new" })).toBe("mutate");
		expect(classifyProgressTool("performance_admit")).toBe("admit");
		expect(classifyProgressTool("write")).toBe("mutate");
		expect(classifyProgressTool("bash", { command: "ls src" })).toBe("explore");
		expect(classifyProgressTool("bash", { command: "git status" })).toBe("explore");
		expect(classifyProgressTool("bash", { command: "npx vitest run" })).toBe("verify");
		expect(classifyProgressTool("bash", { command: "npm run build" })).toBe("mutate");
		expect(classifyProgressTool("performance_gate")).toBe("verify");
		expect(classifyProgressTool("spawn_agent")).toBe("delegate");
	});
});

describe("resolveProgressNudge", () => {
	it("does nothing without current tool results", () => {
		expect(resolveProgressNudge([user("hi")], [])).toBeUndefined();
	});

	it("does not nag after the first explore batch", () => {
		const ls = toolResult("ls-1", "ls");
		expect(resolveProgressNudge(
			[user("看一下仓库"), assistant("先看目录", [{ id: "ls-1", name: "ls" }]), ls],
			[ls],
		)).toBeUndefined();
	});

	it("does not nag a grounding sequence of list, plan, inspect bash, read, and memory", () => {
		const ls = toolResult("ls-1", "ls");
		const plan = toolResult("plan-1", "read_plan");
		const git = toolResult("bash-1", "bash");
		const read = toolResult("read-1", "read");
		const memory = toolResult("mem-1", "query_memory_db");
		const history = [
			user("看看当前工作区"),
			assistant("我先检查当前工作目录的状态。", [{ id: "ls-1", name: "ls" }]),
			ls,
			assistant("", [{ id: "plan-1", name: "read_plan" }]),
			plan,
			assistant("", [{ id: "bash-1", name: "bash", arguments: { command: "git status" } }]),
			git,
			assistant("", [{ id: "read-1", name: "read" }]),
			read,
			assistant("", [{ id: "mem-1", name: "query_memory_db" }]),
			memory,
		];
		expect(resolveProgressNudge(history.slice(0, 3), [ls])).toBeUndefined();
		expect(resolveProgressNudge(history.slice(0, 5), [plan])).toBeUndefined();
		expect(resolveProgressNudge(history.slice(0, 7), [git])).toBeUndefined();
		expect(resolveProgressNudge(history.slice(0, 9), [read])).toBeUndefined();
		expect(resolveProgressNudge(history, [memory])).toBeUndefined();
	});

	it("does not nag later explore-only batches", () => {
		const first = toolResult("ls-1", "ls");
		const second = toolResult("grep-1", "grep");
		expect(resolveProgressNudge(
			[
				user("看一下仓库"),
				assistant("先看目录", [{ id: "ls-1", name: "ls" }]),
				first,
				assistant("", [{ id: "grep-1", name: "grep" }]),
				second,
			],
			[second],
		)).toBeUndefined();
	});

	it("requires a visible update after admission", () => {
		const ls = toolResult("ls-1", "ls");
		const admit = toolResult("admit-1", "performance_admit");
		const nudge = resolveProgressNudge(
			[
				user("写 README"),
				assistant("先看目录", [{ id: "ls-1", name: "ls" }]),
				ls,
				assistant("", [{ id: "admit-1", name: "performance_admit" }]),
				admit,
			],
			[admit],
		);
		expect(nudge).toMatchObject({ kind: "required", reason: "admission" });
		expect(formatProgressNudge(nudge!)).toContain("This is a one-off milestone, not permission to narrate later tools");
		expect(formatProgressNudge(nudge!)).toContain("what you found or what is wrong, and what you will do next");
		expect(formatProgressNudge(nudge!)).toContain("does not skip performance_admit");
		expect(formatProgressNudge(nudge!)).toContain(PROGRESS_NUDGE_MARKER);
		expect(formatProgressNudge(nudge!)).not.toContain("named-child dispatch");
		expect(formatProgressNudge(nudge!)).not.toContain("write the final answer only");
	});

	it("requires a visible update on explore→mutate even without admit", () => {
		const ls = toolResult("ls-1", "ls");
		const write = toolResult("write-1", "write");
		expect(resolveProgressNudge(
			[
				user("写 README"),
				assistant("先看目录", [{ id: "ls-1", name: "ls" }]),
				ls,
				assistant("", [{ id: "write-1", name: "write" }]),
				write,
			],
			[write],
		)).toMatchObject({ kind: "required", reason: "explore→mutate" });
	});

	it("does not require an update for same-phase writes", () => {
		const first = toolResult("write-1", "write");
		const second = toolResult("write-2", "write");
		expect(resolveProgressNudge(
			[
				user("写 README"),
				assistant("开始写", [{ id: "write-1", name: "write" }]),
				first,
				assistant("", [{ id: "write-2", name: "write" }]),
				second,
			],
			[second],
		)).toBeUndefined();
	});

	it("caps non-error nudges to one per user turn", () => {
		const admit = toolResult("admit-1", "performance_admit");
		const write = toolResult("write-1", "write");
		expect(resolveProgressNudge(
			[
				user("写 README"),
				assistant("", [{ id: "admit-1", name: "performance_admit" }]),
				admit,
				context(`${PROGRESS_NUDGE_MARKER} (required: admission; progress-nudge:admit-1).`),
				assistant("", [{ id: "write-1", name: "write" }]),
				write,
			],
			[write],
		)).toBeUndefined();
	});

	it("requires an update when implementation moves to verification", () => {
		const write = toolResult("write-1", "write");
		const test = toolResult("bash-1", "bash");
		expect(resolveProgressNudge(
			[
				user("写 README"),
				assistant("开始写", [{ id: "write-1", name: "write" }]),
				write,
				assistant("", [{ id: "bash-1", name: "bash", arguments: { command: "npx vitest run" } }]),
				test,
			],
			[test],
		)).toMatchObject({ kind: "required", reason: "mutate→verify" });
	});

	it("requires an update on a failed verify even in the same phase", () => {
		const first = toolResult("bash-1", "bash");
		const failed = toolResult("bash-2", "bash", true);
		expect(resolveProgressNudge(
			[
				user("修测试"),
				assistant("先跑测试", [{ id: "bash-1", name: "bash", arguments: { command: "npx vitest run" } }]),
				first,
				assistant("", [{ id: "bash-2", name: "bash", arguments: { command: "npx vitest run" } }]),
				failed,
			],
			[failed],
		)).toMatchObject({ kind: "required", reason: "failed check" });
	});

	it("does not treat a failed explore tool as a milestone", () => {
		const ls = toolResult("ls-1", "ls", true);
		expect(resolveProgressNudge(
			[user("看一下仓库"), assistant("先看目录", [{ id: "ls-1", name: "ls" }]), ls],
			[ls],
		)).toBeUndefined();
	});

	it("requires an update when a gate is blocked", () => {
		const gate = toolResult("gate-1", "performance_gate");
		expect(resolveProgressNudge(
			[
				user("做完"),
				assistant("", [{ id: "gate-1", name: "performance_gate", arguments: { gate: "G4", verdict: "blocked" } }]),
				gate,
			],
			[gate],
		)).toMatchObject({ kind: "required", reason: "failed check" });
	});

	it("requires an update after a passing gate", () => {
		const gate = toolResult("gate-1", "performance_gate");
		expect(resolveProgressNudge(
			[
				user("做完"),
				assistant("", [{ id: "gate-1", name: "performance_gate", arguments: { gate: "G4", verdict: "pass" } }]),
				gate,
			],
			[gate],
		)).toMatchObject({ kind: "required", reason: "gate" });
	});

	it("does not inject the same batch twice", () => {
		const admit = toolResult("admit-1", "performance_admit");
		const key = "progress-nudge:admit-1";
		expect(resolveProgressNudge(
			[
				user("写 README"),
				assistant("", [{ id: "admit-1", name: "performance_admit" }]),
				admit,
				context(`${PROGRESS_NUDGE_MARKER} (required: admission; ${key}).`),
			],
			[admit],
		)).toBeUndefined();
	});
});

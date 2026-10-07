#!/usr/bin/env node
/**
 * Sync contracts/roles.json systemPrompt (+ description/tools) from BUILTIN_AGENTS.
 * Preserves host-specific projection metadata (codex/opencode/deepseek).
 * Writes proper JSON so newlines are real after parse (not literal "\\n").
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, "..");
const rolesPath = join(rootDir, "contracts", "roles.json");

function roleTypeOf(name, tools) {
	if (name === "coordinator" || name.endsWith("-coordinator") || name === "manager" || name === "intake") {
		return "orchestrator";
	}
	if (
		name === "implementer" ||
		name === "researcher" ||
		name === "scoper" ||
		name === "scribe" ||
		name === "sweeper" ||
		name === "synthesizer" ||
		name === "janitor" ||
		name === "execharness-resolver" ||
		name === "framework-generator" ||
		name === "preflight-probe" ||
		name === "re-anchor"
	) {
		return "worker";
	}
	return "checker";
}

function sandboxFor(tools) {
	const mutating = (tools || []).some((t) => ["write", "edit", "bash"].includes(t));
	return mutating ? "workspace-write" : "read-only";
}

function opencodePerm(tools) {
	const set = new Set(tools || []);
	return {
		task: "deny",
		skill: "deny",
		bash: set.has("bash") ? "allow" : "deny",
		write: set.has("write") ? "allow" : "deny",
		edit: set.has("edit") ? "allow" : "deny",
		read: "allow",
	};
}

function deepseekTools(tools) {
	return (tools || []).filter((t) => !["performance_gate", "performance_admit", "spawn_agent"].includes(t));
}

const existing = JSON.parse(readFileSync(rolesPath, "utf-8"));
const byId = new Map(existing.activeRoles.map((r) => [r.id, r]));

const { BUILTIN_AGENTS } = await import(pathToFileURL(join(rootDir, "src/core/agent-definition.ts")).href);

const activeRoles = BUILTIN_AGENTS.map((agent) => {
	const prev = byId.get(agent.name) || {};
	const tools = agent.tools || prev.tools || ["read", "grep", "find", "ls"];
	const roleType = prev.roleType || roleTypeOf(agent.name, tools);
	return {
		id: agent.name,
		name: `metis-${agent.name}`,
		roleType,
		description: agent.description,
		tools,
		nativeDispatchAllowed: false,
		codex: prev.codex || {
			name: `metis_${agent.name.replace(/-/g, "_")}`,
			sandbox_mode: sandboxFor(tools),
		},
		opencode: prev.opencode || {
			mode: "subagent",
			permission: opencodePerm(tools),
		},
		deepseek: prev.deepseek || {
			id: `metis-${agent.name}`,
			cordisPreset: true,
			toolFilter: deepseekTools(tools),
		},
		systemPrompt: agent.systemPrompt,
	};
});

const out = {
	$schema: "http://json-schema.org/draft-07/schema#",
	version: "2.1.0",
	description: "Metis 插件版 - Source of Truth Roles Contract (synced from BUILTIN_AGENTS)",
	activeRoles,
	allowlistedMetisRoles: existing.allowlistedMetisRoles || [],
};

writeFileSync(rolesPath, `${JSON.stringify(out, null, 2)}\n`, "utf-8");

// Sanity: prompts must contain real newlines after parse
const reloaded = JSON.parse(readFileSync(rolesPath, "utf-8"));
const depth = reloaded.activeRoles.find((r) => r.id === "depth-prober");
const researcher = reloaded.activeRoles.find((r) => r.id === "researcher");
const coordinator = reloaded.activeRoles.find((r) => r.id === "coordinator");
const checks = [];
if (!depth?.systemPrompt.includes("\n")) checks.push("depth-prober missing real newlines");
if (depth && depth.systemPrompt.length < 3000) checks.push(`depth-prober truncated: ${depth.systemPrompt.length}`);
if (researcher && researcher.systemPrompt.length < 3000) checks.push(`researcher truncated: ${researcher.systemPrompt.length}`);
if (coordinator && coordinator.systemPrompt.includes("T2 (Feature)")) checks.push("coordinator still has old long prompt");
if (coordinator && !coordinator.systemPrompt.includes("L1 orchestration")) checks.push("coordinator missing rewritten prompt");
if (checks.length) {
	console.error("sync-plugin-roles sanity failed:\n", checks.join("\n"));
	process.exit(1);
}
console.log(`Synced ${activeRoles.length} roles to contracts/roles.json`);
console.log(`  coordinator=${coordinator.systemPrompt.length} depth-prober=${depth.systemPrompt.length} researcher=${researcher.systemPrompt.length}`);

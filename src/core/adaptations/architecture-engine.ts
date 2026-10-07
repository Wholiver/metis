/**
 * Architecture Evolution Engine.
 *
 * Manages tactical playbooks, composite macro-workflows, and project-specific micro tools.
 * Enforces baseline invariant safety:
 * - Cannot override or hide control plane tools (CONTROL_PLANE_TOOLS).
 * - Cannot bypass verification or fabricate receipts.
 * - Project tools are validated before mounting.
 */

import {
	CONTROL_PLANE_TOOLS,
	PROTECTED_BUILTIN_ROLES,
	ADAPTATION_NAME_REGEX,
	type TacticalPlaybook,
	type MacroWorkflow,
	type ProjectMacroTool,
	type ArchitectureEvolution,
} from "./types.ts";
import { assertMainWorkflowInvariance, validateAdaptationName } from "./validate.ts";

export function createEmptyArchitectureEvolution(): ArchitectureEvolution {
	return {
		playbooks: [],
		macroWorkflows: [],
		projectTools: [],
		updatedAt: new Date().toISOString(),
	};
}

/** Validate a tactical playbook. */
export function validateTacticalPlaybook(playbook: unknown): TacticalPlaybook {
	if (!playbook || typeof playbook !== "object") {
		throw new Error("Tactical playbook must be an object");
	}
	const p = playbook as Record<string, any>;
	if (!p.name || typeof p.name !== "string") {
		throw new Error("Playbook requires a valid name");
	}
	if (!p.strategy || typeof p.strategy !== "string") {
		throw new Error("Playbook requires a non-empty strategy string");
	}

	assertMainWorkflowInvariance(p.strategy);

	return {
		id: typeof p.id === "string" ? p.id : p.name.toLowerCase().replace(/\s+/g, "-"),
		name: p.name.trim(),
		description: typeof p.description === "string" ? p.description.trim() : "",
		triggerKeywords: Array.isArray(p.triggerKeywords) ? p.triggerKeywords.filter((k) => typeof k === "string") : [],
		strategy: p.strategy.trim(),
		verificationSteps: Array.isArray(p.verificationSteps) ? p.verificationSteps.filter((v) => typeof v === "string") : undefined,
		confidence: typeof p.confidence === "number" ? Math.min(1, Math.max(0, p.confidence)) : 0.8,
		updatedAt: p.updatedAt || new Date().toISOString(),
		status: p.status === "retired" ? "retired" : p.status === "tentative" ? "tentative" : "active",
	};
}

/** Validate a macro workflow. */
export function validateMacroWorkflow(workflow: unknown): MacroWorkflow {
	if (!workflow || typeof workflow !== "object") {
		throw new Error("Macro workflow must be an object");
	}
	const wf = workflow as Record<string, any>;
	if (!wf.name || typeof wf.name !== "string") {
		throw new Error("Workflow requires a valid name");
	}
	if (!Array.isArray(wf.steps) || wf.steps.length === 0) {
		throw new Error("Workflow must have at least one step");
	}

	const validatedSteps = wf.steps.map((step: any, idx: number) => {
		if (!step || typeof step !== "object" || typeof step.tool !== "string") {
			throw new Error(`Step ${idx + 1} must specify a valid tool name`);
		}
		return {
			tool: step.tool.trim(),
			argsTemplate: step.argsTemplate && typeof step.argsTemplate === "object" ? step.argsTemplate : {},
			description: typeof step.description === "string" ? step.description.trim() : undefined,
			continueOnError: Boolean(step.continueOnError),
		};
	});

	if (wf.description && typeof wf.description === "string") {
		assertMainWorkflowInvariance(wf.description);
	}

	return {
		id: typeof wf.id === "string" ? wf.id : wf.name.toLowerCase().replace(/\s+/g, "-"),
		name: wf.name.trim(),
		description: typeof wf.description === "string" ? wf.description.trim() : "",
		steps: validatedSteps,
		updatedAt: wf.updatedAt || new Date().toISOString(),
		status: wf.status === "retired" ? "retired" : "active",
	};
}

/** Validate a project-specific macro tool. */
export function validateProjectMacroTool(tool: unknown): ProjectMacroTool {
	if (!tool || typeof tool !== "object") {
		throw new Error("Project macro tool must be an object");
	}
	const t = tool as Record<string, any>;
	if (!t.name || typeof t.name !== "string") {
		throw new Error("Tool requires a valid name");
	}

	validateAdaptationName(t.name);

	if (CONTROL_PLANE_TOOLS.includes(t.name)) {
		throw new Error(`Cannot define project tool '${t.name}': conflicts with control-plane tool`);
	}

	if (!t.script || typeof t.script !== "string" || !t.script.trim()) {
		throw new Error("Tool requires a non-empty script body");
	}

	assertMainWorkflowInvariance(t.description || "");

	return {
		name: t.name.trim(),
		description: typeof t.description === "string" ? t.description.trim() : "",
		parameters: t.parameters && typeof t.parameters === "object" ? t.parameters : {},
		script: t.script.trim(),
		runtime: t.runtime === "bash" ? "bash" : "node",
		createdAt: t.createdAt || new Date().toISOString(),
		status: t.status === "retired" ? "retired" : "active",
	};
}

/**
 * Add or update a playbook in the architecture evolution.
 */
export function upsertPlaybook(
	evolution: ArchitectureEvolution,
	playbook: TacticalPlaybook,
): ArchitectureEvolution {
	const playbooks = [...(evolution.playbooks || [])];
	const index = playbooks.findIndex((p) => p.id === playbook.id || p.name === playbook.name);
	if (index >= 0) {
		playbooks[index] = playbook;
	} else {
		playbooks.push(playbook);
	}
	return {
		...evolution,
		playbooks,
		updatedAt: new Date().toISOString(),
	};
}

/**
 * Add or update a macro workflow in the architecture evolution.
 */
export function upsertMacroWorkflow(
	evolution: ArchitectureEvolution,
	workflow: MacroWorkflow,
): ArchitectureEvolution {
	const macroWorkflows = [...(evolution.macroWorkflows || [])];
	const index = macroWorkflows.findIndex((w) => w.id === workflow.id || w.name === workflow.name);
	if (index >= 0) {
		macroWorkflows[index] = workflow;
	} else {
		macroWorkflows.push(workflow);
	}
	return {
		...evolution,
		macroWorkflows,
		updatedAt: new Date().toISOString(),
	};
}

/**
 * Add or update a project macro tool in the architecture evolution.
 */
export function upsertProjectMacroTool(
	evolution: ArchitectureEvolution,
	tool: ProjectMacroTool,
): ArchitectureEvolution {
	const projectTools = [...(evolution.projectTools || [])];
	const index = projectTools.findIndex((t) => t.name === tool.name);
	if (index >= 0) {
		projectTools[index] = tool;
	} else {
		projectTools.push(tool);
	}
	return {
		...evolution,
		projectTools,
		updatedAt: new Date().toISOString(),
	};
}

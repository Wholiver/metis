import type { ThinkingLevel } from "./agent-definition.ts";

export const HARNESS_DOCUMENT_VERSION = 1 as const;

export type HarnessNodeType = "tier" | "framework" | "gate" | "role";

export interface HarnessCheck {
	command: string;
	expectExit: number;
	artifactPath?: string;
}

export type HarnessGateOnFail = "block" | `loop-to:${string}`;

export interface HarnessGateNodeData {
	id: string;
	name: string;
	invariant?: string;
	checks?: HarnessCheck[];
	rubric?: string;
	onFail?: HarnessGateOnFail;
}

export interface HarnessRoleNodeData {
	id: string;
	name: string;
	description: string;
	systemPrompt: string;
	tools?: string[];
	model?: string;
	thinking?: ThinkingLevel;
	maxSpawnDepth?: number;
}

export interface HarnessTierNodeData {
	id: string;
	name: string;
	description?: string;
}

export interface HarnessFrameworkNodeData {
	id: string;
	name: string;
	category?: string;
	tier?: string;
	description?: string;
}

export type HarnessNodeData =
	| HarnessTierNodeData
	| HarnessFrameworkNodeData
	| HarnessGateNodeData
	| HarnessRoleNodeData;

export interface HarnessNode<T extends HarnessNodeData = HarnessNodeData> {
	id: string;
	type: HarnessNodeType;
	data: T;
	position?: { x: number; y: number };
}

export type HarnessEdgeType =
	| "tier-framework"
	| "framework-gate"
	| "gate-role"
	| "role-delegation"
	| string;

export interface HarnessEdge {
	id: string;
	source: string;
	target: string;
	type?: HarnessEdgeType;
	order?: number;
}

export interface HarnessDocument {
	version: 1;
	nodes: HarnessNode[];
	edges: HarnessEdge[];
	metadata?: {
		createdAt?: string;
		updatedAt?: string;
		description?: string;
		author?: string;
	};
}

export interface HarnessValidationResult {
	valid: boolean;
	errors: string[];
}

const VALID_THINKING_LEVELS: ReadonlySet<string> = new Set([
	"off",
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
]);

/**
 * Validate the structural integrity of a Harness document.
 * Only validates structural contracts (version, unique IDs, edge endpoint existence, check field types, loop-to targets).
 * Does NOT fail on intentional deletions such as omitting G6 or reviewer.
 */
export function validateHarnessDocument(doc: unknown): HarnessValidationResult {
	const errors: string[] = [];

	if (!doc || typeof doc !== "object" || Array.isArray(doc)) {
		return { valid: false, errors: ["Document must be a JSON object."] };
	}

	const candidate = doc as Record<string, unknown>;

	if (candidate.version !== HARNESS_DOCUMENT_VERSION) {
		errors.push(`Document version must be ${HARNESS_DOCUMENT_VERSION}, got ${String(candidate.version)}.`);
	}

	if (!Array.isArray(candidate.nodes)) {
		errors.push("Document 'nodes' must be an array.");
	}

	if (!Array.isArray(candidate.edges)) {
		errors.push("Document 'edges' must be an array.");
	}

	if (errors.length > 0) {
		return { valid: false, errors };
	}

	const nodes = candidate.nodes as unknown[];
	const edges = candidate.edges as unknown[];
	const nodeIds = new Set<string>();

	for (let i = 0; i < nodes.length; i++) {
		const node = nodes[i];
		if (!node || typeof node !== "object" || Array.isArray(node)) {
			errors.push(`Node at index ${i} must be an object.`);
			continue;
		}

		const n = node as Record<string, unknown>;
		if (typeof n.id !== "string" || !n.id.trim()) {
			errors.push(`Node at index ${i} is missing a non-empty string 'id'.`);
			continue;
		}

		if (nodeIds.has(n.id)) {
			errors.push(`Duplicate node id "${n.id}" at index ${i}.`);
		}
		nodeIds.add(n.id);

		if (typeof n.type !== "string" || !["tier", "framework", "gate", "role"].includes(n.type)) {
			errors.push(`Node "${n.id}" has invalid type "${String(n.type)}". Expected "tier", "framework", "gate", or "role".`);
		}

		if (!n.data || typeof n.data !== "object" || Array.isArray(n.data)) {
			errors.push(`Node "${n.id}" is missing an object 'data' payload.`);
			continue;
		}

		const data = n.data as Record<string, unknown>;

		if (n.type === "role") {
			if (typeof data.name !== "string" || !data.name.trim()) {
				errors.push(`Role node "${n.id}" must have a non-empty string 'name'.`);
			}
			if (typeof data.description !== "string") {
				errors.push(`Role node "${n.id}" must have a string 'description'.`);
			}
			if (typeof data.systemPrompt !== "string") {
				errors.push(`Role node "${n.id}" must have a string 'systemPrompt'.`);
			}
			if (data.tools !== undefined && !Array.isArray(data.tools)) {
				errors.push(`Role node "${n.id}" 'tools' must be an array of strings if defined.`);
			}
			if (data.model !== undefined && typeof data.model !== "string") {
				errors.push(`Role node "${n.id}" 'model' must be a string if defined.`);
			}
			if (data.thinking !== undefined && (typeof data.thinking !== "string" || !VALID_THINKING_LEVELS.has(data.thinking))) {
				errors.push(`Role node "${n.id}" 'thinking' has invalid value "${String(data.thinking)}".`);
			}
			if (data.maxSpawnDepth !== undefined && (typeof data.maxSpawnDepth !== "number" || data.maxSpawnDepth < 0)) {
				errors.push(`Role node "${n.id}" 'maxSpawnDepth' must be a non-negative number if defined.`);
			}
		} else if (n.type === "gate") {
			if (typeof data.name !== "string" || !data.name.trim()) {
				errors.push(`Gate node "${n.id}" must have a non-empty string 'name'.`);
			}
			if (data.checks !== undefined) {
				if (!Array.isArray(data.checks)) {
					errors.push(`Gate node "${n.id}" 'checks' must be an array if defined.`);
				} else {
					for (let cIdx = 0; cIdx < data.checks.length; cIdx++) {
						const check = data.checks[cIdx];
						if (!check || typeof check !== "object" || Array.isArray(check)) {
							errors.push(`Gate node "${n.id}" check at index ${cIdx} must be an object.`);
							continue;
						}
						const chk = check as Record<string, unknown>;
						if (typeof chk.command !== "string" || !chk.command.trim()) {
							errors.push(`Gate node "${n.id}" check at index ${cIdx} must have a non-empty string 'command'.`);
						}
						if (typeof chk.expectExit !== "number" || !Number.isInteger(chk.expectExit)) {
							errors.push(`Gate node "${n.id}" check at index ${cIdx} must have an integer 'expectExit'.`);
						}
						if (chk.artifactPath !== undefined && (typeof chk.artifactPath !== "string" || !chk.artifactPath.trim())) {
							errors.push(`Gate node "${n.id}" check at index ${cIdx} 'artifactPath' must be a non-empty string if provided.`);
						}
					}
				}
			}
			if (data.rubric !== undefined && typeof data.rubric !== "string") {
				errors.push(`Gate node "${n.id}" 'rubric' must be a string if defined.`);
			}
			if (data.onFail !== undefined) {
				if (typeof data.onFail !== "string") {
					errors.push(`Gate node "${n.id}" 'onFail' must be a string if defined.`);
				} else if (data.onFail !== "block" && !data.onFail.startsWith("loop-to:")) {
					errors.push(`Gate node "${n.id}" 'onFail' must be "block" or "loop-to:<nodeId>".`);
				}
			}
		} else if (n.type === "framework") {
			if (typeof data.name !== "string" || !data.name.trim()) {
				errors.push(`Framework node "${n.id}" must have a non-empty string 'name'.`);
			}
		} else if (n.type === "tier") {
			if (typeof data.name !== "string" || !data.name.trim()) {
				errors.push(`Tier node "${n.id}" must have a non-empty string 'name'.`);
			}
		}

		if (n.position !== undefined) {
			if (!n.position || typeof n.position !== "object" || Array.isArray(n.position)) {
				errors.push(`Node "${n.id}" 'position' must be an object with numeric x and y if defined.`);
			} else {
				const pos = n.position as Record<string, unknown>;
				if (typeof pos.x !== "number" || typeof pos.y !== "number") {
					errors.push(`Node "${n.id}" 'position' coordinates (x, y) must be numbers.`);
				}
			}
		}
	}

	// Post-check for gate onFail loop-to target existence
	for (const node of nodes) {
		if (node && typeof node === "object" && !Array.isArray(node)) {
			const n = node as Record<string, unknown>;
			if (n.type === "gate" && n.data && typeof n.data === "object") {
				const data = n.data as Record<string, unknown>;
				if (typeof data.onFail === "string" && data.onFail.startsWith("loop-to:")) {
					const targetId = data.onFail.slice("loop-to:".length).trim();
					if (!nodeIds.has(targetId)) {
						errors.push(`Gate node "${String(n.id)}" specifies loop-to target "${targetId}" which does not exist in nodes.`);
					}
				}
			}
		}
	}

	const edgeIds = new Set<string>();
	for (let i = 0; i < edges.length; i++) {
		const edge = edges[i];
		if (!edge || typeof edge !== "object" || Array.isArray(edge)) {
			errors.push(`Edge at index ${i} must be an object.`);
			continue;
		}

		const e = edge as Record<string, unknown>;
		if (typeof e.id !== "string" || !e.id.trim()) {
			errors.push(`Edge at index ${i} is missing a non-empty string 'id'.`);
			continue;
		}

		if (edgeIds.has(e.id)) {
			errors.push(`Duplicate edge id "${e.id}" at index ${i}.`);
		}
		edgeIds.add(e.id);

		if (typeof e.source !== "string" || !nodeIds.has(e.source)) {
			errors.push(`Edge "${e.id}" source "${String(e.source)}" does not exist in nodes.`);
		}

		if (typeof e.target !== "string" || !nodeIds.has(e.target)) {
			errors.push(`Edge "${e.id}" target "${String(e.target)}" does not exist in nodes.`);
		}

		if (e.order !== undefined && typeof e.order !== "number") {
			errors.push(`Edge "${e.id}" 'order' must be a number if defined.`);
		}
	}

	return {
		valid: errors.length === 0,
		errors,
	};
}

/**
 * Assert that a document matches the Harness schema, throwing a descriptive Error if invalid.
 */
export function assertValidHarnessDocument(doc: unknown, filePath = ".metis/harness.json"): HarnessDocument {
	const result = validateHarnessDocument(doc);
	if (!result.valid) {
		throw new Error(
			`Harness configuration at ${filePath} is invalid:\n- ${result.errors.join("\n- ")}`,
		);
	}
	return doc as HarnessDocument;
}

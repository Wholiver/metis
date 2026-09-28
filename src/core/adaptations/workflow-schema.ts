import { PROTECTED_BUILTIN_ROLES } from "./types.ts";

export interface WorkflowExtraCheck {
	id: string;
	name: string;
	condition?: string;
	command?: string;
	description?: string;
	status?: "active" | "retired" | "pending";
	gate?: string;
	blocking?: boolean;
}

export interface WorkflowAdaptation {
	/** Dynamic extra verification checks appended to performance run gates. */
	extraChecks?: WorkflowExtraCheck[];
	/** Subagent route bias, mapping role to role (within legal built-in roles). */
	routeBias?: Record<string, string>;
	/** User addenda for verification and planning. */
	userAddenda?: string[];
	/** Specific verification commands discovered for the project. */
	verificationCommands?: string[];
	/** Completion / done criteria rules. */
	doneCriteria?: string[];
}

export function validateWorkflowAdaptation(data: unknown): WorkflowAdaptation {
	if (typeof data !== "object" || data === null) {
		throw new Error("Workflow adaptation must be a JSON object");
	}

	const raw = data as Record<string, unknown>;
	const result: WorkflowAdaptation = {};

	if (raw.extraChecks !== undefined) {
		if (!Array.isArray(raw.extraChecks)) {
			throw new Error("extraChecks must be an array");
		}
		result.extraChecks = raw.extraChecks.map((item, index) => {
			if (typeof item !== "object" || item === null) {
				throw new Error(`extraChecks[${index}] must be an object`);
			}
			const check = item as Record<string, unknown>;
			if (typeof check.id !== "string" || !check.id.trim()) {
				throw new Error(`extraChecks[${index}].id is required and must be a string`);
			}
			if (typeof check.name !== "string" || !check.name.trim()) {
				throw new Error(`extraChecks[${index}].name is required and must be a string`);
			}
			const validStatuses = ["active", "retired", "pending"];
			if (check.status !== undefined && !validStatuses.includes(String(check.status))) {
				throw new Error(`extraChecks[${index}].status must be one of: ${validStatuses.join(", ")}`);
			}
			return {
				id: check.id.trim(),
				name: check.name.trim(),
				condition: typeof check.condition === "string" ? check.condition.trim() : undefined,
				command: typeof check.command === "string" ? check.command.trim() : undefined,
				description: typeof check.description === "string" ? check.description.trim() : undefined,
				status: (check.status as "active" | "retired" | "pending") ?? "active",
				gate: typeof check.gate === "string" ? check.gate.trim() : undefined,
				blocking: typeof check.blocking === "boolean" ? check.blocking : false,
			};
		});
	}

	if (raw.routeBias !== undefined) {
		if (typeof raw.routeBias !== "object" || raw.routeBias === null || Array.isArray(raw.routeBias)) {
			throw new Error("routeBias must be an object mapping roles");
		}
		const bias = raw.routeBias as Record<string, unknown>;
		const sanitizedBias: Record<string, string> = {};
		for (const [fromRole, targetRole] of Object.entries(bias)) {
			if (typeof targetRole !== "string") {
				throw new Error(`routeBias target for '${fromRole}' must be a string`);
			}
			// Route bias must stay within legal roles
			if (!PROTECTED_BUILTIN_ROLES.includes(targetRole) && targetRole !== "lead") {
				throw new Error(
					`routeBias target role '${targetRole}' is invalid. Target must be a recognized role: ${PROTECTED_BUILTIN_ROLES.join(", ")}`,
				);
			}
			sanitizedBias[fromRole] = targetRole;
		}
		result.routeBias = sanitizedBias;
	}

	if (raw.userAddenda !== undefined) {
		if (!Array.isArray(raw.userAddenda) || !raw.userAddenda.every((item) => typeof item === "string")) {
			throw new Error("userAddenda must be an array of strings");
		}
		result.userAddenda = [...raw.userAddenda];
	}

	if (raw.verificationCommands !== undefined) {
		if (!Array.isArray(raw.verificationCommands) || !raw.verificationCommands.every((item) => typeof item === "string")) {
			throw new Error("verificationCommands must be an array of strings");
		}
		result.verificationCommands = [...raw.verificationCommands];
	}

	if (raw.doneCriteria !== undefined) {
		if (!Array.isArray(raw.doneCriteria) || !raw.doneCriteria.every((item) => typeof item === "string")) {
			throw new Error("doneCriteria must be an array of strings");
		}
		result.doneCriteria = [...raw.doneCriteria];
	}

	return result;
}

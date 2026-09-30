import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import {
	ADAPTATION_NAME_REGEX,
	ADAPTATION_SIZE_LIMITS,
	type AdaptationKind,
	type AdaptationScope,
	PROTECTED_BUILTIN_ROLES,
	CONTROL_PLANE_TOOLS,
} from "./types.ts";

export class AdaptationValidationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "AdaptationValidationError";
	}
}

/** Validate that adaptation artifact name conforms to safety and format standards. */
export function validateAdaptationName(name: string): void {
	if (!name || typeof name !== "string") {
		throw new AdaptationValidationError("Adaptation name is required and must be a string");
	}
	if (name.includes("..") || name.includes("/") || name.includes("\\") || name.includes("\0")) {
		throw new AdaptationValidationError(`Adaptation name contains illegal path traversal characters: '${name}'`);
	}
	if (!ADAPTATION_NAME_REGEX.test(name)) {
		throw new AdaptationValidationError(
			`Adaptation name '${name}' is invalid. Must match ^[a-z0-9][a-z0-9_-]{0,63}$`,
		);
	}
}

/** Verify that targetPath is strictly inside baseDir to prevent path traversal attacks. */
export function assertNoPathTraversal(baseDir: string, targetPath: string): void {
	const resolvedBase = resolve(baseDir);
	const resolvedTarget = resolve(targetPath);
	if (!resolvedTarget.startsWith(resolvedBase + "/") && resolvedTarget !== resolvedBase) {
		throw new AdaptationValidationError(
			`Path traversal violation: target path '${targetPath}' escapes base directory '${baseDir}'`,
		);
	}
}

/** Verify that learned role does not conflict with protected built-in roles. */
export function assertNoProtectedRoleCollision(name: string): void {
	if (PROTECTED_BUILTIN_ROLES.includes(name.toLowerCase())) {
		throw new AdaptationValidationError(
			`Cannot define adaptation role '${name}'. It conflicts with protected built-in performance role.`,
		);
	}
}

/** Verify that adaptation does not overwrite a user-authored handwritten resource. */
export function assertNoHandwrittenCollision(agentDir: string, kind: AdaptationKind, name: string): void {
	let handwrittenPath: string | undefined;

	switch (kind) {
		case "skill":
			handwrittenPath = join(agentDir, "skills", name);
			break;
		case "role":
			handwrittenPath = join(agentDir, "roles", `${name}.md`);
			if (!existsSync(handwrittenPath)) {
				handwrittenPath = join(agentDir, "agents", `${name}.md`);
			}
			break;
		case "tool":
			handwrittenPath = join(agentDir, "tools", `${name}.ts`);
			break;
		case "hook":
			handwrittenPath = join(agentDir, "hooks", `${name}.ts`);
			break;
		default:
			break;
	}

	if (handwrittenPath && existsSync(handwrittenPath)) {
		throw new AdaptationValidationError(
			`Cannot write adaptation '${name}' of kind '${kind}'. It collides with user-authored resource at ${handwrittenPath}.`,
		);
	}
}

/** Verify that the artifact size is within the allowed budget. */
export function assertSizeLimit(kind: AdaptationKind, byteLength: number): void {
	const limit = ADAPTATION_SIZE_LIMITS[kind];
	if (limit !== undefined && byteLength > limit) {
		throw new AdaptationValidationError(
			`Adaptation of kind '${kind}' size (${byteLength} bytes) exceeds limit of ${limit} bytes`,
		);
	}
}

/** Verify project trust requirement for project-scoped adaptations. */
export function assertProjectTrusted(projectTrusted: boolean, scope: AdaptationScope): void {
	if (scope === "project" && !projectTrusted) {
		throw new AdaptationValidationError(
			"Cannot load or apply project-level adaptations in an untrusted project.",
		);
	}
}

const FORBIDDEN_GATE_REGEX = /\b(?:G[0-7]|G3\.5)(?:-assurance)?\b/i;
const FORBIDDEN_RECEIPT_REGEX = /\b(?:verificationReceipt|independentVerificationReceipt|receipt)\b/i;
const FORBIDDEN_BYPASS_PATTERNS = [
	/跳过.*(?:验证|gate|检查|核验)/i,
	/绕过.*(?:验证|gate|检查|核验)/i,
	/直接完成/i,
	/无需.*(?:验证|核验|测试|检查)/i,
	/skip.*(?:verification|receipt|gate|check)/i,
	/bypass.*(?:verification|receipt|gate|check)/i,
	/finish.*directly/i,
	/complete.*without.*verification/i,
];

/**
 * Content guard to ensure adaptations never influence or tamper with the main reliable-headless workflow.
 * Any content mentioning control plane tools, performance gate numbers, receipt fields,
 * or intent to bypass/skip verification is rejected immediately.
 */
export function assertMainWorkflowInvariance(content: string): void {
	if (!content || typeof content !== "string") return;

	for (const tool of CONTROL_PLANE_TOOLS) {
		const regex = new RegExp(`\\b${tool}\\b`, "i");
		if (regex.test(content)) {
			throw new AdaptationValidationError(
				`Content violation: mentions control-plane tool '${tool}'. Main workflow cannot be influenced.`,
			);
		}
	}

	if (FORBIDDEN_GATE_REGEX.test(content)) {
		throw new AdaptationValidationError(
			"Content violation: mentions performance gate identifiers (e.g. G0-G7). Main workflow gates cannot be modified.",
		);
	}

	for (const pattern of FORBIDDEN_BYPASS_PATTERNS) {
		if (pattern.test(content)) {
			throw new AdaptationValidationError(
				"Content violation: contains intent to bypass, skip, or force completion without verification.",
			);
		}
	}

	if (FORBIDDEN_RECEIPT_REGEX.test(content)) {
		throw new AdaptationValidationError(
			"Content violation: mentions performance receipt fields. Verification receipts are strictly protected.",
		);
	}
}

/**
 * Dangerous process injection and elevated privilege environment variables to exclude (Feat 24)
 */
export const DANGEROUS_ENV_VARS = [
	"LD_PRELOAD",
	"LD_LIBRARY_PATH",
	"LD_AUDIT",
	"DYLD_INSERT_LIBRARIES",
	"DYLD_LIBRARY_PATH",
	"DYLD_FRAMEWORK_PATH",
	"DYLD_FALLBACK_FRAMEWORK_PATH",
	"DYLD_FALLBACK_LIBRARY_PATH",
	"DYLD_IMAGE_SUFFIX",
	"DYLD_SHARED_REGION",
	"SUDO_COMMAND",
	"SUDO_USER",
	"SUDO_UID",
	"SUDO_GID",
] as const;

const DANGEROUS_SET = new Set<string>(DANGEROUS_ENV_VARS.map((k) => k.toUpperCase()));

/**
 * Filter parent environment variables against the blacklist and merge explicit overrides (Feat 24)
 */
export function filterChildEnvironment(
	parentEnv: NodeJS.ProcessEnv = process.env,
	explicitOverrides?: Record<string, string | undefined>,
): Record<string, string | undefined> {
	const sanitized: Record<string, string | undefined> = {};

	for (const [key, value] of Object.entries(parentEnv)) {
		if (value !== undefined && !DANGEROUS_SET.has(key.toUpperCase())) {
			sanitized[key] = value;
		}
	}

	if (explicitOverrides) {
		for (const [key, value] of Object.entries(explicitOverrides)) {
			if (value !== undefined) {
				sanitized[key] = value;
			}
		}
	}

	return sanitized;
}

/**
 * Key patterns for identifying sensitive credentials in JSON / Trace payloads (Feat 59)
 */
const SENSITIVE_KEY_REGEX = /^(api_?key|token|secret|password|auth|authorization|private_?key|credential|bearer)$/i;

/**
 * Common API key string patterns (OpenAI, Anthropic, OpenRouter, GitHub, etc.)
 */
const SENSITIVE_VALUE_REGEX = /(?:sk-[a-zA-Z0-9_-]{8,}|ghp_[a-zA-Z0-9]{20,}|Bearer\s+[a-zA-Z0-9._-]{10,})/g;

/**
 * Mask a secret string value (e.g. sk-1234567890 -> sk-****[REDACTED])
 */
export function maskSecretValue(val: string): string {
	if (!val || typeof val !== "string") return val;
	if (val.startsWith("Bearer ")) {
		return "Bearer [REDACTED]";
	}
	if (val.startsWith("sk-")) {
		return "sk-****[REDACTED]";
	}
	if (val.startsWith("ghp_")) {
		return "[REDACTED]";
	}
	if (val.length <= 4) {
		return "[REDACTED]";
	}
	return `${val.slice(0, 2)}****[REDACTED]`;
}

/**
 * Sanitize strings by masking known API key patterns
 */
export function sanitizeSensitiveString(text: string): string {
	if (!text || typeof text !== "string") return text;
	return text.replace(SENSITIVE_VALUE_REGEX, (matched) => {
		if (matched.startsWith("Bearer ")) {
			return "Bearer [REDACTED]";
		}
		if (matched.startsWith("sk-")) {
			return "sk-****[REDACTED]";
		}
		return "[REDACTED]";
	});
}

/**
 * Recursively sanitize JSON / Trace data structures to mask sensitive credentials (Feat 59)
 */
export function sanitizeTraceData<T>(data: T): T {
	if (data === null || data === undefined) {
		return data;
	}

	if (typeof data === "string") {
		return sanitizeSensitiveString(data) as unknown as T;
	}

	if (Array.isArray(data)) {
		return data.map((item) => sanitizeTraceData(item)) as unknown as T;
	}

	if (typeof data === "object") {
		const result: Record<string, any> = {};
		for (const [key, value] of Object.entries(data as Record<string, any>)) {
			if (SENSITIVE_KEY_REGEX.test(key) && typeof value === "string") {
				result[key] = maskSecretValue(value);
			} else {
				result[key] = sanitizeTraceData(value);
			}
		}
		return result as T;
	}

	return data;
}

export interface SelfLearningActivationOptions {
	/** CLI flag --adaptations on|off */
	adaptationsFlag?: "on" | "off";
	/** Environment variables (e.g. process.env) */
	env?: Record<string, string | undefined>;
	/** Execution profile (e.g. 'reliable-headless') */
	executionProfile?: string;
	/** Settings configuration */
	settings?: {
		selfLearning?: {
			enabled?: boolean;
		};
	};
}

/**
 * Determine whether self-learning / adaptations are active.
 *
 * Precedence:
 * 1. Explicit off: CLI `--adaptations off` or METIS_ADAPTATIONS=off|0|false -> false (trumps everything).
 * 2. Explicit on: CLI `--adaptations on` or METIS_ADAPTATIONS=on|1|true -> true.
 * 3. Benchmark isolation: `executionProfile === "reliable-headless"` defaults to false unless explicitly turned on.
 * 4. Configuration fallback: `settings.selfLearning.enabled` (defaults to false).
 */
export function isSelfLearningActive(options?: SelfLearningActivationOptions): boolean {
	const envVal = options?.env
		? options.env.METIS_ADAPTATIONS
		: typeof process !== "undefined"
			? process.env?.METIS_ADAPTATIONS
			: undefined;
	const normalizedEnv = envVal ? envVal.trim().toLowerCase() : undefined;

	const flag = options?.adaptationsFlag;

	// 1. Explicit off trumps everything
	if (flag === "off" || normalizedEnv === "off" || normalizedEnv === "0" || normalizedEnv === "false") {
		return false;
	}

	// 2. Explicit on
	if (flag === "on" || normalizedEnv === "on" || normalizedEnv === "1" || normalizedEnv === "true") {
		return true;
	}

	// 3. Reliable-headless (benchmark isolation) defaults to false unless explicitly enabled via flag/env
	if (options?.executionProfile === "reliable-headless") {
		return false;
	}

	// 4. Configuration fallback
	return options?.settings?.selfLearning?.enabled ?? false;
}

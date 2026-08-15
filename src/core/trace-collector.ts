/**
 * Full lifecycle Trace Context and aggregated Token/Cost/Latency collector
 * (Feats 35, 36, 37, 38)
 */

export interface TraceContext {
	rootRunId: string;
	agentId: string;
	parentId?: string;
	depth: number;
	provider?: string;
	model?: string;
	baseUrl?: string;
}

export interface AgentTokenStats {
	agentId: string;
	agentName?: string;
	parentId?: string;
	depth: number;
	provider?: string;
	model?: string;
	baseUrl?: string;
	inputTokens: number;
	outputTokens: number;
	cacheReadTokens: number;
	cacheWriteTokens: number;
	cost: number;
	durationMs: number;
	turnCount: number;
}

export interface TraceSummaryPayload {
	type: "trace_summary";
	rootRunId: string;
	totalInputTokens: number;
	totalOutputTokens: number;
	totalCacheReadTokens: number;
	totalCacheWriteTokens: number;
	totalCost: number;
	totalDurationMs: number;
	agentCount: number;
	agents: AgentTokenStats[];
}

export class TraceCollector {
	private readonly agentStats = new Map<string, AgentTokenStats>();
	private readonly startTime = Date.now();
	private readonly rootRunId: string;

	constructor(rootRunId: string) {
		this.rootRunId = rootRunId;
	}

	public getRootRunId(): string {
		return this.rootRunId;
	}

	public recordUsage(
		agentId: string,
		usage: {
			input?: number;
			output?: number;
			cacheRead?: number;
			cacheWrite?: number;
			cost?: number;
			durationMs?: number;
		},
		metadata?: Partial<AgentTokenStats>,
	): void {
		let stats = this.agentStats.get(agentId);
		if (!stats) {
			stats = {
				agentId,
				agentName: metadata?.agentName ?? agentId,
				parentId: metadata?.parentId,
				depth: metadata?.depth ?? 0,
				provider: metadata?.provider,
				model: metadata?.model,
				baseUrl: metadata?.baseUrl,
				inputTokens: 0,
				outputTokens: 0,
				cacheReadTokens: 0,
				cacheWriteTokens: 0,
				cost: 0,
				durationMs: 0,
				turnCount: 0,
			};
			this.agentStats.set(agentId, stats);
		}

		if (metadata?.provider) stats.provider = metadata.provider;
		if (metadata?.model) stats.model = metadata.model;
		if (metadata?.baseUrl) stats.baseUrl = metadata.baseUrl;
		if (metadata?.parentId !== undefined) stats.parentId = metadata.parentId;
		if (metadata?.depth !== undefined) stats.depth = metadata.depth;

		stats.inputTokens += usage.input ?? 0;
		stats.outputTokens += usage.output ?? 0;
		stats.cacheReadTokens += usage.cacheRead ?? 0;
		stats.cacheWriteTokens += usage.cacheWrite ?? 0;
		stats.cost += usage.cost ?? 0;
		stats.durationMs += usage.durationMs ?? 0;
		stats.turnCount += 1;
	}

	public mergeChildTrace(childTrace: AgentTokenStats | TraceSummaryPayload): void {
		if ("type" in childTrace && childTrace.type === "trace_summary") {
			for (const agent of childTrace.agents) {
				this.agentStats.set(agent.agentId, agent);
			}
		} else {
			const stats = childTrace as AgentTokenStats;
			this.agentStats.set(stats.agentId, stats);
		}
	}

	public getSummary(): TraceSummaryPayload {
		const agents = Array.from(this.agentStats.values());
		let totalInputTokens = 0;
		let totalOutputTokens = 0;
		let totalCacheReadTokens = 0;
		let totalCacheWriteTokens = 0;
		let totalCost = 0;
		let totalDurationMs = Date.now() - this.startTime;

		for (const agent of agents) {
			totalInputTokens += agent.inputTokens;
			totalOutputTokens += agent.outputTokens;
			totalCacheReadTokens += agent.cacheReadTokens;
			totalCacheWriteTokens += agent.cacheWriteTokens;
			totalCost += agent.cost;
		}

		return {
			type: "trace_summary",
			rootRunId: this.rootRunId,
			totalInputTokens,
			totalOutputTokens,
			totalCacheReadTokens,
			totalCacheWriteTokens,
			totalCost,
			totalDurationMs,
			agentCount: Math.max(1, agents.length),
			agents,
		};
	}

	public injectTraceContext<T extends Record<string, any>>(event: T, context: TraceContext): T & { traceContext: TraceContext } {
		if (event && typeof event === "object") {
			return {
				...event,
				traceContext: {
					...context,
				},
			};
		}
		return event as any;
	}
}

let globalTraceCollector: TraceCollector | undefined;

export function getGlobalTraceCollector(rootRunId?: string): TraceCollector {
	if (!globalTraceCollector || (rootRunId && globalTraceCollector.getRootRunId() !== rootRunId)) {
		globalTraceCollector = new TraceCollector(rootRunId ?? `run-${Date.now()}`);
	}
	return globalTraceCollector;
}

export function setGlobalTraceCollector(collector: TraceCollector): void {
	globalTraceCollector = collector;
}

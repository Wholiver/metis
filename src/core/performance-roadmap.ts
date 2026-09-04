import { getPerformanceFramework } from "./performance-frameworks.ts";

export const PERFORMANCE_ROADMAP_CATEGORIES = ["plan", "backend", "frontend", "data", "integration", "infra", "docs"] as const;
export const PERFORMANCE_ROADMAP_TAGS = ["debug", "research", "user-facing", "polish", "external-target"] as const;
export const PERFORMANCE_ROADMAP_TIERS = ["T0", "T1", "T2", "T3"] as const;

export type PerformanceRoadmapCategory = (typeof PERFORMANCE_ROADMAP_CATEGORIES)[number];
export type PerformanceRoadmapTag = (typeof PERFORMANCE_ROADMAP_TAGS)[number] | "none";
export type PerformanceRoadmapTier = (typeof PERFORMANCE_ROADMAP_TIERS)[number];

export interface PerformanceRoadmapItem {
	id: string;
	category: PerformanceRoadmapCategory;
	tag: PerformanceRoadmapTag;
	tier: PerformanceRoadmapTier;
	framework: string;
	ownedBoundaries: string;
	dependencies: string[];
	launchGroup: string;
	integrationLane: string;
	implementationSteps: string;
	acceptanceCriteria: string;
	unhappyPaths: string;
	testsFirstSteps: string;
	verificationCommands: string;
	/** Required only for the apply framework; makes mechanical admission falsifiable. */
	exactChangeSpecification?: string;
	requiresDetailedPlan: boolean;
	detailedPlanReason?: string;
}

export interface PerformanceItemGatePolicy {
	requiresPlan: boolean;
	requiresCharacterization: boolean;
	requiresDepthLock: boolean;
	requiredJurors: number;
}

const REQUIRED_ITEM_FIELDS = [
	"Category", "Tag", "Tier", "Framework", "Owned boundaries", "Dependencies", "Launch group", "Integration lane",
	"Implementation steps", "Acceptance criteria", "Unhappy paths", "Tests-first steps", "Verification commands", "requiresDetailedPlan",
] as const;

/** Accept common model paraphrases of the canonical field labels. */
const FIELD_ALIASES: Record<(typeof REQUIRED_ITEM_FIELDS)[number] | "Detailed plan reason" | "Exact change specification", string[]> = {
	Category: ["category", "Category", "类别", "分类"],
	Tag: ["tag", "Tag", "标签"],
	Tier: ["tier", "Tier", "层级", "等级"],
	Framework: ["framework", "Framework", "框架"],
	"Owned boundaries": ["owned boundaries", "owned boundary", "Owned boundaries", "Owned boundary", "负责边界", "拥有边界", "边界"],
	Dependencies: ["dependencies", "dependency ids", "dependency IDs", "Dependencies", "依赖", "依赖项"],
	"Launch group": ["launch group", "Launch group", "启动组", "发布组"],
	"Integration lane": ["integration lane", "Integration lane", "集成通道", "集成策略"],
	"Implementation steps": ["implementation steps", "Implementation steps", "implementation", "Implementation", "实现步骤", "实施步骤"],
	"Acceptance criteria": ["acceptance criteria", "positive acceptance criteria", "Acceptance criteria", "acceptance", "Acceptance", "验收标准", "验收条件"],
	"Unhappy paths": ["unhappy paths", "Unhappy paths", "异常路径", "非正常路径"],
	"Tests-first steps": ["tests-first steps", "tests to write first", "Tests-first steps", "tests-first", "Tests-first", "测试优先步骤", "测试先行"],
	"Verification commands": ["verification commands", "real verification instructions", "Verification commands", "verification", "Verification", "验证命令", "校验命令"],
	requiresDetailedPlan: ["requiresDetailedPlan", "requires detailed plan", "requires_detailed_plan"],
	"Detailed plan reason": ["detailed plan reason", "Detailed plan reason"],
	"Exact change specification": ["exact change specification", "Exact change specification"],
};

const CATEGORY_ALIASES: Record<string, PerformanceRoadmapCategory> = {
	plan: "plan",
	planning: "plan",
	backend: "backend",
	frontend: "frontend",
	data: "data",
	integration: "integration",
	infra: "infra",
	infrastructure: "infra",
	docs: "docs",
	doc: "docs",
	documentation: "docs",
	verify: "docs",
	verification: "docs",
};

const FRAMEWORK_ALIASES: Record<string, string> = {
	docs: "docs",
	"build-docs": "docs",
	"docs-build": "docs",
	documentation: "docs",
	"verify-assurance": "docs",
	"verify-docs": "docs",
	"plan-scope": "plan-scope",
	"plan-design": "plan-design",
	"plan-research": "plan-research",
};

function stripDecorators(value: string): string {
	return value
		.trim()
		.replace(/^[*_`]+|[*_`]+$/g, "")
		.replace(/^\[|\]$/g, "")
		.trim();
}

function rejectPlaceholder(value: string, field: string, itemId: string): string {
	const trimmed = stripDecorators(value);
	if (!trimmed || /^(?:TBD|N\/A|\[.*\])\s*$/i.test(trimmed)) {
		if (field === "Dependencies" || field === "Tag" || field === "requiresDetailedPlan") {
			return trimmed;
		}
		throw new Error(`ROADMAP.md item ${itemId} has no concrete ${field}.`);
	}
	return trimmed;
}

function field(body: string, label: keyof typeof FIELD_ALIASES, itemId: string): string {
	const aliases = FIELD_ALIASES[label] ?? [label];
	for (const alias of aliases) {
		const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		// Accept single line (including after semicolon), with optional bullet and colon/full-width colon
		const single = body.match(new RegExp(`(?:^|\\r?\\n|;)\\s*(?:[-*•]\\s*)?(?:\\*\\*)?${escaped}(?:\\*\\*)?\\s*[:：]\\s*([^;\\r\\n]+)`, "im"));
		if (single?.[1]) {
			const candidate = single[1].trim();
			if (candidate) {
				return rejectPlaceholder(candidate, label, itemId);
			}
		}
		// Accept multiline blocks
		const multi = body.match(new RegExp(`(?:^|\\r?\\n)\\s*(?:[-*•]\\s*)?(?:\\*\\*)?${escaped}(?:\\*\\*)?\\s*[:：]\\s*$([\\s\\S]*?)(?=^\\s*[-*•]\\s|\\Z)`, "im"));
		if (multi?.[1]?.trim()) {
			return rejectPlaceholder(multi[1].replace(/\n+/g, " ").trim(), label, itemId);
		}
	}
	if (label === "Dependencies" || label === "Tag") {
		return "none";
	}
	throw new Error(
		`ROADMAP.md item ${itemId} is missing ${label}. Use the seeded template fields exactly (e.g. "- ${label}: ...").`,
	);
}

function parseDependencies(value: string, itemId: string): string[] {
	const normalized = stripDecorators(value)
		.replace(/^\[/, "")
		.replace(/\]$/, "")
		.trim();
	if (!normalized || /^(?:none|-)$/i.test(normalized)) return [];
	const dependencies = normalized
		.split(",")
		.map((entry) => stripDecorators(entry))
		.filter(Boolean);
	if (!dependencies.length || dependencies.some((entry) => !/^[A-Za-z][A-Za-z0-9._-]*$/.test(entry))) {
		return [];
	}
	if (new Set(dependencies).size !== dependencies.length || dependencies.includes(itemId)) {
		return Array.from(new Set(dependencies.filter((d) => d !== itemId)));
	}
	return dependencies;
}

function normalizeCategory(raw: string, itemId: string): PerformanceRoadmapCategory {
	const key = stripDecorators(raw).toLowerCase();
	const mapped = CATEGORY_ALIASES[key];
	if (mapped) return mapped;
	if (key.includes("plan") || key.includes("scope")) return "plan";
	if (key.includes("data") || key.includes("eval") || key.includes("base") || key.includes("metric")) return "data";
	if (key.includes("opt") || key.includes("back") || key.includes("calc") || key.includes("model") || key.includes("calib")) return "backend";
	if (key.includes("front") || key.includes("ui") || key.includes("view")) return "frontend";
	if (key.includes("infra") || key.includes("env") || key.includes("docker") || key.includes("tool")) return "infra";
	if (key.includes("doc") || key.includes("report") || key.includes("artifact") || key.includes("output")) return "docs";
	if (key.includes("test") || key.includes("valid") || key.includes("check") || key.includes("gate") || key.includes("assur")) return "docs";
	return "backend";
}

function normalizeTag(raw: string): PerformanceRoadmapTag {
	const key = stripDecorators(raw).toLowerCase();
	if (key === "none" || !key) return "none";
	if (PERFORMANCE_ROADMAP_TAGS.includes(key as Exclude<PerformanceRoadmapTag, "none">)) {
		return key as PerformanceRoadmapTag;
	}
	// Free-form tags from models should not block G2; keep semantics via "none".
	return "none";
}

function normalizeFramework(raw: string, itemId: string): string {
	const key = stripDecorators(raw).toLowerCase();
	const mapped = FRAMEWORK_ALIASES[key] ?? key;
	if (getPerformanceFramework(mapped)) return mapped;
	if (key.includes("scope") || key.includes("plan")) return "plan-scope";
	if (key.includes("doc") || key.includes("report") || key.includes("artifact")) return "docs";
	if (key.includes("python") || key.includes("pytest") || key.includes("script") || key.includes("code") || key.includes("test") || key.includes("leap") || key.includes("backend") || key.includes("torch") || key.includes("numpy")) {
		if (getPerformanceFramework("backend-implement")) return "backend-implement";
	}
	throw new Error(
		`ROADMAP.md item ${itemId} references unknown Framework ${JSON.stringify(raw)}. Prefer a seeded framework id such as docs, plan-scope, backend-implement.`,
	);
}

/** Parse the canonical per-item ROADMAP.md contract before G2 can pass. */
export function parsePerformanceRoadmapItems(markdown: string): PerformanceRoadmapItem[] {
	const headingRegex = /^[^\S\r\n]*#{2,4}[^\S\r\n]+(?:(?:Item|Task|Feature)[^\S\r\n]*[:：][^\S\r\n]*)?`?([A-Za-z0-9._-]+)`?(?:[^\S\r\n]+[^\r\n]*|[^\S\r\n]*[\-\u2014\u2013:：][^\r\n]*)?$/gm;
	const candidates = [...markdown.matchAll(headingRegex)];
	const validMatches: { id: string; body: string }[] = [];
	for (let i = 0; i < candidates.length; i++) {
		const match = candidates[i]!;
		const next = candidates[i + 1];
		const body = markdown.slice(match.index + match[0].length, next?.index ?? markdown.length);
		const id = match[1]!;
		const isExcluded = /^(Items|Scope|Repository|Framework|Boundaries|Delivery|Overview|Background|Context|Dependencies|Architecture|Feature|Features|Completion|Dependency|Roadmap|Gate|Execution|Summary|Conclusion|Milestone|Phase|Section|Table)$/i.test(id);
		if (isExcluded) continue;
		const hasExplicitPrefix = /^[^\S\r\n]*#{2,4}[^\S\r\n]+(?:Item|Task|Feature)[^\S\r\n]*[:：]/i.test(match[0]);
		const hasCategory = /(?:^|\r?\n|;)\s*(?:[-*•]\s*)?(?:\*\*)?(?:Category|类别|分类)(?:\*\*)?\s*[:：]/i.test(body);
		if (hasExplicitPrefix || hasCategory) {
			validMatches.push({ id, body });
		}
	}
	if (!validMatches.length) {
		throw new Error(
			"ROADMAP.md must contain at least one '## Item: <stable-id>' section. Edit the seeded ROADMAP.md template in place; do not replace it with free-form headings.",
		);
	}
	const items = validMatches.map(({ id, body }) => {
		const category = normalizeCategory(field(body, "Category", id), id);
		const tag = normalizeTag(field(body, "Tag", id));
		const rawTier = stripDecorators(field(body, "Tier", id));
		const tier: PerformanceRoadmapTier = /T?[1-3]/i.test(rawTier)
			? (`T${rawTier.replace(/[^1-3]/g, "")}` as PerformanceRoadmapTier)
			: PERFORMANCE_ROADMAP_TIERS.includes(rawTier as PerformanceRoadmapTier)
				? (rawTier as PerformanceRoadmapTier)
				: "T1";
		const framework = normalizeFramework(field(body, "Framework", id), id);
		const frameworkDefinition = getPerformanceFramework(framework)!;
		const requiredCategory = frameworkDefinition.category === "planning"
			? "plan"
			: frameworkDefinition.category === "polish"
				? "frontend"
				: PERFORMANCE_ROADMAP_CATEGORIES.includes(frameworkDefinition.category as PerformanceRoadmapCategory)
					? frameworkDefinition.category as PerformanceRoadmapCategory
					: undefined;
		let resolvedFramework = framework;
		if (requiredCategory && category !== requiredCategory) {
			// Models often keep plan-scope across items; align framework gracefully to avoid blocking G2
			const candidate = category === "docs" ? "docs" : category === "plan" ? "plan-scope" : undefined;
			if (candidate && getPerformanceFramework(candidate)) {
				resolvedFramework = candidate;
			} else {
				throw new Error(`ROADMAP.md item ${id} uses ${framework} for ${requiredCategory} work, not ${category}.`);
			}
		}
		if (resolvedFramework.endsWith("-fix") && tag !== "debug") {
			throw new Error(`ROADMAP.md item ${id} uses ${resolvedFramework} and must carry Tag: debug.`);
		}
		if (resolvedFramework === "polish" && tag !== "polish") {
			throw new Error(`ROADMAP.md item ${id} uses polish and must carry Tag: polish.`);
		}
		const detailed = stripDecorators(field(body, "requiresDetailedPlan", id));
		if (!/^(?:true|false)$/i.test(detailed)) {
			throw new Error(`ROADMAP.md item ${id} requiresDetailedPlan must be true or false.`);
		}
		const detailedPlanReason = detailed.toLowerCase() === "true" ? field(body, "Detailed plan reason", id) : undefined;
		const exactChangeSpecification = resolvedFramework === "apply" ? field(body, "Exact change specification", id) : undefined;
		return {
			id,
			category,
			tag,
			tier,
			framework: resolvedFramework,
			ownedBoundaries: field(body, "Owned boundaries", id),
			dependencies: parseDependencies(field(body, "Dependencies", id), id),
			launchGroup: field(body, "Launch group", id),
			integrationLane: field(body, "Integration lane", id),
			implementationSteps: field(body, "Implementation steps", id),
			acceptanceCriteria: field(body, "Acceptance criteria", id),
			unhappyPaths: field(body, "Unhappy paths", id),
			testsFirstSteps: field(body, "Tests-first steps", id),
			verificationCommands: field(body, "Verification commands", id),
			exactChangeSpecification,
			requiresDetailedPlan: detailed.toLowerCase() === "true",
			detailedPlanReason,
		} satisfies PerformanceRoadmapItem;
	});
	const ids = items.map((item) => item.id);
	if (new Set(ids).size !== ids.length) throw new Error("ROADMAP.md item IDs must be unique.");
	for (const item of items) {
		for (const dependency of item.dependencies) {
			if (!ids.includes(dependency)) throw new Error(`ROADMAP.md item ${item.id} depends on unknown item ${dependency}.`);
		}
	}
	assertAcyclicDependencies(items);
	assertDisjointOwnedBoundaries(items);
	return items;
}

function assertAcyclicDependencies(items: PerformanceRoadmapItem[]): void {
	const byId = new Map(items.map((item) => [item.id, item]));
	const visiting = new Set<string>();
	const visited = new Set<string>();
	const visit = (id: string, stack: string[]): void => {
		if (visited.has(id)) return;
		if (visiting.has(id)) {
			throw new Error(`ROADMAP.md dependency graph contains a cycle involving ${[...stack, id].join(" -> ")}.`);
		}
		visiting.add(id);
		for (const dependency of byId.get(id)?.dependencies ?? []) visit(dependency, [...stack, id]);
		visiting.delete(id);
		visited.add(id);
	};
	for (const item of items) visit(item.id, []);
}

function assertDisjointOwnedBoundaries(items: PerformanceRoadmapItem[]): void {
	for (let i = 0; i < items.length; i++) {
		for (let j = i + 1; j < items.length; j++) {
			const left = items[i]!;
			const right = items[j]!;
			const a = left.ownedBoundaries.trim();
			const b = right.ownedBoundaries.trim();
			if (!a || !b) continue;
			if (a === b || a.startsWith(`${b}/`) || a.startsWith(`${b}\\`) || b.startsWith(`${a}/`) || b.startsWith(`${a}\\`)) {
				throw new Error(`ROADMAP.md items ${left.id} and ${right.id} have overlapping owned boundaries.`);
			}
		}
	}
}

export function performanceItemGatePolicy(item: PerformanceRoadmapItem): PerformanceItemGatePolicy {
	const framework = getPerformanceFramework(item.framework);
	const requiresDepthLock = item.tag === "debug" || Boolean(framework?.id.endsWith("-fix"));
	const requiresCharacterization = requiresDepthLock || item.framework === "refactor";
	const requiresPlan = item.requiresDetailedPlan || requiresDepthLock;
	const requiredJurors = item.tier === "T3" ? 3 : item.tier === "T2" ? 1 : 0;
	return {
		requiresPlan,
		requiresCharacterization,
		requiresDepthLock,
		requiredJurors,
	};
}


export type HarnessNodeType = "tier" | "framework" | "gate" | "role";

export interface HarnessCheck {
	command: string;
	expectExit: number;
	artifactPath?: string;
}

export interface HarnessCheckResult {
	check: HarnessCheck;
	passed: boolean;
	actualExit?: number;
	artifactFound?: boolean;
	output?: string;
	error?: string;
}

export type HarnessGateOnFail = "block" | `loop-to:${string}`;

export interface HarnessTierNodeData {
	label: string;
	tier: number | "fast-path";
	name: string;
	description?: string;
}

export interface HarnessFrameworkNodeData {
	label: string;
	frameworkId: string;
	name: string;
	description?: string;
}

export interface HarnessGateNodeData {
	label?: string;
	gateId?: string;
	name: string;
	invariant?: string;
	checks?: HarnessCheck[];
	rubric?: string;
	onFail?: HarnessGateOnFail;
	description?: string;
}

export interface HarnessRoleNodeData {
	label: string;
	name: string;
	description?: string;
	systemPrompt?: string;
	tools?: string[];
	model?: string;
	thinking?: string;
	maxSpawnDepth?: number;
}

export type HarnessNodeData =
	| HarnessTierNodeData
	| HarnessFrameworkNodeData
	| HarnessGateNodeData
	| HarnessRoleNodeData
	| Record<string, unknown>;

export interface HarnessNode {
	id: string;
	type: HarnessNodeType;
	data: HarnessNodeData;
	position?: { x: number; y: number };
}

export interface HarnessEdge {
	id: string;
	source: string;
	target: string;
	type?: string;
	order?: number;
	label?: string;
}

export interface HarnessDocument {
	version: 1;
	name?: string;
	description?: string;
	nodes: HarnessNode[];
	edges: HarnessEdge[];
}

export interface HarnessToolDefinition {
	id: string;
	label: string;
	category: "core" | "search" | "web" | "agent" | "advanced";
	descriptionZh: string;
	descriptionEn: string;
}

export const HARNESS_AVAILABLE_TOOLS: readonly HarnessToolDefinition[] = [
	{ id: "read", label: "read", category: "core", descriptionZh: "读取文件内容与范围", descriptionEn: "Read file contents" },
	{ id: "edit", label: "edit", category: "core", descriptionZh: "精确编辑修改文件代码", descriptionEn: "Edit existing files" },
	{ id: "write", label: "write", category: "core", descriptionZh: "创建或覆写文件", descriptionEn: "Write files" },
	{ id: "bash", label: "bash", category: "core", descriptionZh: "执行终端 Shell 命令", descriptionEn: "Execute shell commands" },
	{ id: "grep", label: "grep", category: "search", descriptionZh: "正则全文检索文件内容", descriptionEn: "Regex search across files" },
	{ id: "find", label: "find", category: "search", descriptionZh: "按文件名模式查找文件", descriptionEn: "Find files by pattern" },
	{ id: "ls", label: "ls", category: "search", descriptionZh: "查看目录结构与文件属性", descriptionEn: "List directory entries" },
	{ id: "websearch", label: "websearch", category: "web", descriptionZh: "互联网实时公开信息检索", descriptionEn: "Search the web" },
	{ id: "webfetch", label: "webfetch", category: "web", descriptionZh: "抓取网页并提取 Markdown 正文", descriptionEn: "Fetch web page content" },
	{ id: "browser", label: "browser", category: "web", descriptionZh: "浏览器自动化与交互", descriptionEn: "Browser automation" },
	{ id: "spawn_agent", label: "spawn_agent", category: "agent", descriptionZh: "派生与调度子代理任务", descriptionEn: "Spawn subagent tasks" },
	{ id: "performance_gate", label: "performance_gate", category: "agent", descriptionZh: "执行质量门检查与判定", descriptionEn: "Quality gate checks" },
	{ id: "video", label: "video", category: "advanced", descriptionZh: "视频文件解析与关键帧提取", descriptionEn: "Inspect video files" },
	{ id: "routine", label: "routine", category: "advanced", descriptionZh: "自动化例程执行与管理", descriptionEn: "Automation routines" },
	{ id: "adapt", label: "adapt", category: "advanced", descriptionZh: "运行时环境策略自适应", descriptionEn: "Runtime adaptations" },
];

export const COMMON_DEV_TOOLS: readonly string[] = [
	"read",
	"edit",
	"write",
	"bash",
	"grep",
	"find",
	"ls",
];

export const READ_ONLY_TOOLS: readonly string[] = [
	"read",
	"grep",
	"find",
	"ls",
];


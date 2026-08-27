/**
 * CLI argument parsing and help display
 */

import type { ThinkingLevel } from "@earendil-works/metis-agent-core";
import chalk from "chalk";
import { APP_NAME, CONFIG_DIR_NAME, ENV_AGENT_DIR, ENV_SESSION_DIR } from "../config.ts";
import type { ExtensionFlag } from "../core/extensions/types.ts";
import type { CollaborationMode } from "../core/workflow-runtime.ts";

export type Mode = "text" | "json" | "rpc" | "server";

export interface Args {
	provider?: string;
	model?: string;
	apiKey?: string;
	baseInstructions?: string;
	developerInstructions?: string[];
	collaborationMode?: CollaborationMode;
	thinking?: ThinkingLevel;
	continue?: boolean;
	resume?: boolean;
	help?: boolean;
	version?: boolean;
	mode?: Mode;
	hostname?: string;
	port?: number;
	cors?: string[];
	name?: string;
	noSession?: boolean;
	session?: string;
	sessionId?: string;
	fork?: string;
	sessionDir?: string;
	models?: string[];
	tools?: string[];
	excludeTools?: string[];
	noTools?: boolean;
	noBuiltinTools?: boolean;
	extensions?: string[];
	noExtensions?: boolean;
	print?: boolean;
	export?: string;
	noSkills?: boolean;
	skills?: string[];
	promptTemplates?: string[];
	noPromptTemplates?: boolean;
	themes?: string[];
	noThemes?: boolean;
	noContextFiles?: boolean;
	listModels?: string | true;
	offline?: boolean;
	verbose?: boolean;
	projectTrustOverride?: boolean;
	agent?: string;
	depth?: number;
	parentId?: string;
	rootRunId?: string;
	agentContext?: string;
	agentChain?: string[];
	maxSpawnDepth?: number;
	maxChildren?: number;
	maxConcurrent?: number;
	timeout?: number;
	baseUrl?: string;
	outputFinalAnswer?: string;
	messages: string[];
	fileArgs: string[];
	/** Unknown flags (potentially extension flags) - map of flag name to value */
	unknownFlags: Map<string, boolean | string>;
	diagnostics: Array<{ type: "warning" | "error"; message: string }>;
}

/**
 * Levels Metis itself knows about. Providers may expose their own native levels
 * (see `thinkingOptions` on a model), so this list is not the set of accepted
 * values — it only disambiguates `model:suffix` patterns, where an unknown
 * suffix is far more likely to be part of the model id (`qwen3-coder:exacto`)
 * than a thinking level.
 */
const KNOWN_THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;

/** True for a level Metis ships built-in support for. Used for pattern suffix parsing. */
export function isKnownThinkingLevel(level: string): level is ThinkingLevel {
	return (KNOWN_THINKING_LEVELS as readonly string[]).includes(level);
}

/**
 * Accepts any non-empty level so provider-native values (e.g. a provider that
 * exposes "ultra") can be passed through `--thinking`. Validation against the
 * active model happens later via the model's `thinkingOptions`.
 */
export function isValidThinkingLevel(level: string): level is ThinkingLevel {
	return level.trim().length > 0;
}

export function parseArgs(args: string[]): Args {
	const result: Args = {
		messages: [],
		fileArgs: [],
		unknownFlags: new Map(),
		diagnostics: [],
	};

	for (let i = 0; i < args.length; i++) {
		const arg = args[i];

		if (arg === "--help" || arg === "-h") {
			result.help = true;
		} else if (arg === "--version" || arg === "-v") {
			result.version = true;
		} else if (arg === "server") {
			result.mode = "server";
		} else if (arg === "--mode" && i + 1 < args.length) {
			const mode = args[++i];
			if (mode === "text" || mode === "json" || mode === "rpc" || mode === "server") {
				result.mode = mode as Mode;
			}
		} else if (arg === "--hostname" && i + 1 < args.length) {
			result.hostname = args[++i];
		} else if (arg === "--port" && i + 1 < args.length) {
			const rawPort = args[++i];
			const parsedPort = parseInt(rawPort, 10);
			if (Number.isNaN(parsedPort) || parsedPort < 1 || parsedPort > 65535) {
				result.diagnostics.push({ type: "error", message: `Invalid port: ${rawPort}` });
			} else {
				result.port = parsedPort;
			}
		} else if (arg === "--cors" && i + 1 < args.length) {
			result.cors = result.cors ?? [];
			result.cors.push(args[++i]);
		} else if (arg === "--continue" || arg === "-c") {
			result.continue = true;
		} else if (arg === "--resume" || arg === "-r") {
			result.resume = true;
		} else if (arg === "--provider" && i + 1 < args.length) {
			result.provider = args[++i];
		} else if (arg === "--model" && i + 1 < args.length) {
			result.model = args[++i];
		} else if (arg === "--api-key" && i + 1 < args.length) {
			result.apiKey = args[++i];
		} else if (arg === "--system-prompt" || arg === "--append-system-prompt") {
			if (i + 1 < args.length && !args[i + 1].startsWith("-")) i++;
			result.diagnostics.push({
				type: "error",
				message: `${arg} was removed. Use --base-instructions or --developer-instructions instead.`,
			});
		} else if (arg === "--base-instructions" && i + 1 < args.length) {
			result.baseInstructions = args[++i];
		} else if (arg === "--developer-instructions" && i + 1 < args.length) {
			result.developerInstructions = result.developerInstructions ?? [];
			result.developerInstructions.push(args[++i]);
		} else if (arg === "--collaboration-mode" && i + 1 < args.length) {
			const mode = args[++i];
			if (mode === "build" || mode === "plan") {
				result.collaborationMode = mode;
			} else {
				result.diagnostics.push({ type: "error", message: `Invalid collaboration mode: ${mode}. Use build or plan.` });
			}
		} else if (arg === "--name" || arg === "-n") {
			if (i + 1 < args.length) {
				result.name = args[++i];
			} else {
				result.diagnostics.push({ type: "error", message: "--name requires a value" });
			}
		} else if (arg === "--no-session") {
			result.noSession = true;
		} else if (arg === "--session" && i + 1 < args.length) {
			result.session = args[++i];
		} else if (arg === "--session-id" && i + 1 < args.length) {
			result.sessionId = args[++i];
		} else if (arg === "--fork" && i + 1 < args.length) {
			result.fork = args[++i];
		} else if (arg === "--session-dir" && i + 1 < args.length) {
			result.sessionDir = args[++i];
		} else if (arg === "--models" && i + 1 < args.length) {
			result.models = args[++i].split(",").map((s) => s.trim());
		} else if (arg === "--no-tools" || arg === "-nt") {
			result.noTools = true;
		} else if (arg === "--no-builtin-tools" || arg === "-nbt") {
			result.noBuiltinTools = true;
		} else if ((arg === "--tools" || arg === "-t") && i + 1 < args.length) {
			result.tools = args[++i]
				.split(",")
				.map((s) => s.trim())
				.filter((name) => name.length > 0);
		} else if ((arg === "--exclude-tools" || arg === "-xt") && i + 1 < args.length) {
			result.excludeTools = args[++i]
				.split(",")
				.map((s) => s.trim())
				.filter((name) => name.length > 0);
		} else if (arg === "--thinking" && i + 1 < args.length) {
			const level = args[++i];
			if (isValidThinkingLevel(level)) {
				result.thinking = level;
			} else {
				result.diagnostics.push({
					type: "warning",
					message: `Invalid thinking level "${level}". Provide a level exposed by the model, e.g. ${KNOWN_THINKING_LEVELS.join(", ")}`,
				});
			}
		} else if (arg === "--print" || arg === "-p") {
			result.print = true;
			const next = args[i + 1];
			if (next !== undefined && !next.startsWith("@") && (!next.startsWith("-") || next.startsWith("---"))) {
				result.messages.push(next);
				i++;
			}
		} else if (arg === "--export" && i + 1 < args.length) {
			result.export = args[++i];
		} else if ((arg === "--extension" || arg === "-e") && i + 1 < args.length) {
			result.extensions = result.extensions ?? [];
			result.extensions.push(args[++i]);
		} else if (arg === "--no-extensions" || arg === "-ne") {
			result.noExtensions = true;
		} else if (arg === "--skill" && i + 1 < args.length) {
			result.skills = result.skills ?? [];
			result.skills.push(args[++i]);
		} else if (arg === "--prompt-template" && i + 1 < args.length) {
			result.promptTemplates = result.promptTemplates ?? [];
			result.promptTemplates.push(args[++i]);
		} else if (arg === "--theme" && i + 1 < args.length) {
			result.themes = result.themes ?? [];
			result.themes.push(args[++i]);
		} else if (arg === "--no-skills" || arg === "-ns") {
			result.noSkills = true;
		} else if (arg === "--no-prompt-templates" || arg === "-np") {
			result.noPromptTemplates = true;
		} else if (arg === "--no-themes") {
			result.noThemes = true;
		} else if (arg === "--no-context-files" || arg === "-nc") {
			result.noContextFiles = true;
		} else if (arg === "--list-models") {
			// Check if next arg is a search pattern (not a flag or file arg)
			if (i + 1 < args.length && !args[i + 1].startsWith("-") && !args[i + 1].startsWith("@")) {
				result.listModels = args[++i];
			} else {
				result.listModels = true;
			}
		} else if (arg === "--verbose") {
			result.verbose = true;
		} else if (arg === "--approve" || arg === "-a") {
			result.projectTrustOverride = true;
		} else if (arg === "--no-approve" || arg === "-na") {
			result.projectTrustOverride = false;
		} else if (arg === "--offline") {
			result.offline = true;
		} else if (arg === "--agent" && i + 1 < args.length) {
			result.agent = args[++i];
		} else if ((arg === "--depth" || arg === "--agent-depth") && i + 1 < args.length) {
			const rawDepth = args[++i];
			const parsedDepth = parseInt(rawDepth, 10);
			if (Number.isNaN(parsedDepth) || parsedDepth < 0) {
				result.diagnostics.push({ type: "error", message: `Invalid depth: ${rawDepth}` });
			} else {
				result.depth = parsedDepth;
			}
		} else if ((arg === "--parent-id" || arg === "--parent-agent-id") && i + 1 < args.length) {
			result.parentId = args[++i];
		} else if (arg === "--root-run-id" && i + 1 < args.length) {
			result.rootRunId = args[++i];
		} else if (arg === "--agent-context" && i + 1 < args.length) {
			result.agentContext = args[++i];
		} else if (arg === "--agent-chain" && i + 1 < args.length) {
			result.agentChain = args[++i].split(",").map((s) => s.trim()).filter(Boolean);
		} else if (arg === "--max-spawn-depth" && i + 1 < args.length) {
			const rawVal = args[++i];
			const parsedVal = parseInt(rawVal, 10);
			if (Number.isNaN(parsedVal) || parsedVal < 0) {
				result.diagnostics.push({ type: "error", message: `Invalid max-spawn-depth: ${rawVal}` });
			} else {
				result.maxSpawnDepth = parsedVal;
			}
		} else if (arg === "--max-children" && i + 1 < args.length) {
			const rawVal = args[++i];
			const parsedVal = parseInt(rawVal, 10);
			if (Number.isNaN(parsedVal) || parsedVal < 1) {
				result.diagnostics.push({ type: "error", message: `Invalid max-children: ${rawVal}` });
			} else {
				result.maxChildren = parsedVal;
			}
		} else if (arg === "--max-concurrent" && i + 1 < args.length) {
			const rawVal = args[++i];
			const parsedVal = parseInt(rawVal, 10);
			if (Number.isNaN(parsedVal) || parsedVal < 1) {
				result.diagnostics.push({ type: "error", message: `Invalid max-concurrent: ${rawVal}` });
			} else {
				result.maxConcurrent = parsedVal;
			}
		} else if (arg === "--timeout" && i + 1 < args.length) {
			const rawVal = args[++i];
			const parsedVal = parseInt(rawVal, 10);
			if (Number.isNaN(parsedVal) || parsedVal < 1) {
				result.diagnostics.push({ type: "error", message: `Invalid timeout: ${rawVal}` });
			} else {
				result.timeout = parsedVal;
			}
		} else if (arg === "--base-url" && i + 1 < args.length) {
			result.baseUrl = args[++i];
		} else if (arg === "--output-final-answer" && i + 1 < args.length) {
			result.outputFinalAnswer = args[++i];
		} else if (arg.startsWith("@")) {
			result.fileArgs.push(arg.slice(1)); // Remove @ prefix
		} else if (arg.startsWith("--")) {
			const eqIndex = arg.indexOf("=");
			if (eqIndex !== -1) {
				result.unknownFlags.set(arg.slice(2, eqIndex), arg.slice(eqIndex + 1));
			} else {
				const flagName = arg.slice(2);
				const next = args[i + 1];
				if (next !== undefined && !next.startsWith("-") && !next.startsWith("@")) {
					result.unknownFlags.set(flagName, next);
					i++;
				} else {
					result.unknownFlags.set(flagName, true);
				}
			}
		} else if (arg.startsWith("-") && !arg.startsWith("--")) {
			result.diagnostics.push({ type: "error", message: `Unknown option: ${arg}` });
		} else if (!arg.startsWith("-")) {
			result.messages.push(arg);
		}
	}

	return result;
}

export function printHelp(extensionFlags?: ExtensionFlag[]): void {
	const extensionFlagsText =
		extensionFlags && extensionFlags.length > 0
			? `\n${chalk.bold("Extension CLI Flags:")}\n${extensionFlags
					.map((flag) => {
						const value = flag.type === "string" ? " <value>" : "";
						const description = flag.description ?? `Registered by ${flag.extensionPath}`;
						return `  --${flag.name}${value}`.padEnd(30) + description;
					})
					.join("\n")}\n`
			: "";
	console.log(`${chalk.bold(APP_NAME)} - AI coding assistant with read, bash, edit, write tools

${chalk.bold("Usage:")}
  ${APP_NAME} [options] [@files...] [messages...]

${chalk.bold("Commands:")}
  ${APP_NAME} install <source> [-l]     Install extension source and add to settings
  ${APP_NAME} remove <source> [-l]      Remove extension source from settings
  ${APP_NAME} uninstall <source> [-l]   Alias for remove
  ${APP_NAME} update [source|self|metis]   Update metis (use --all for metis and extensions)
  ${APP_NAME} list                      List installed extensions from settings
  ${APP_NAME} config                    Open TUI to enable/disable package resources
  ${APP_NAME} <command> --help          Show help for install/remove/uninstall/update/list

${chalk.bold("Options:")}
  --provider <name>              Provider name (default: google)
  --model <pattern>              Model pattern or ID (supports "provider/id" and optional ":<thinking>")
  --base-url <url>               Base URL for OpenAI-compatible endpoint (e.g. http://localhost:8000/v1)
  --api-key <key>                API key (defaults to env vars)
  --output-final-answer <file>   Write final assistant text response to isolated file
  --base-instructions <text>     Replace built-in base instruction profile
  --developer-instructions <text> Add trusted developer instructions (repeatable)
  --collaboration-mode <mode>    Workflow mode: plan (default) or build
  --mode <mode>                  Output mode: text (default), json, or rpc
  --print, -p                    Non-interactive mode: process prompt and exit
  --continue, -c                 Continue previous session
  --resume, -r                   Select a session to resume
  --session <path|id>            Use specific session file or partial UUID
  --session-id <id>              Use exact project session ID, creating it if missing
  --fork <path|id>               Fork specific session file or partial UUID into a new session
  --session-dir <dir>            Directory for session storage and lookup
  --no-session                   Don't save session (ephemeral)
  --name, -n <name>              Set session display name
  --models <patterns>            Comma-separated model patterns for Ctrl+P cycling
                                 Supports globs (anthropic/*, *sonnet*) and fuzzy matching
  --no-tools, -nt                Disable all tools by default (built-in and extension)
  --no-builtin-tools, -nbt       Disable built-in tools by default but keep extension/custom tools enabled
  --tools, -t <tools>            Comma-separated allowlist of tool names to enable
                                 Applies to built-in, extension, and custom tools
  --exclude-tools, -xt <tools>   Comma-separated denylist of tool names to disable
                                 Applies to built-in, extension, and custom tools
  --thinking <level>             Set thinking level: off, minimal, low, medium, high, xhigh
  --extension, -e <path>         Load an extension file (can be used multiple times)
  --no-extensions, -ne           Disable extension discovery (explicit -e paths still work)
  --skill <path>                 Load a skill file or directory (can be used multiple times)
  --no-skills, -ns               Disable skills discovery and loading
  --prompt-template <path>       Load a prompt template file or directory (can be used multiple times)
  --no-prompt-templates, -np     Disable prompt template discovery and loading
  --theme <path>                 Load a theme file or directory (can be used multiple times)
  --no-themes                    Disable theme discovery and loading
  --no-context-files, -nc        Disable AGENTS.md and CLAUDE.md discovery and loading
  --export <file>                Export session file to HTML and exit
  --list-models [search]         List available models (with optional fuzzy search)
  --agent <name>                 Run as specific named agent (e.g. coordinator, planner, implementer)
  --depth, --agent-depth <n>     Agent recursion depth level (0=root, 1=L1, ...)
  --parent-id <id>               Parent agent identifier
  --root-run-id <id>             Root run identifier across recursive agent tree
  --agent-context <text>         Inject additional context payload to agent prompt
  --verbose                      Force verbose startup (overrides quietStartup setting)
  --approve, -a                  Trust project-local files for this run
  --no-approve, -na              Ignore project-local files for this run
  --offline                      Disable startup network operations (same as METIS_OFFLINE=1)
  --help, -h                     Show this help
  --version, -v                  Show version number

Extensions can register additional flags.${extensionFlagsText}

${chalk.bold("Examples:")}
  # Interactive mode
  ${APP_NAME}

  # Interactive mode with initial prompt
  ${APP_NAME} "List all .ts files in src/"

  # Include files in initial message
  ${APP_NAME} @prompt.md @image.png "What color is the sky?"

  # Non-interactive mode (process and exit)
  ${APP_NAME} -p "List all .ts files in src/"

  # Multiple messages (interactive)
  ${APP_NAME} "Read package.json" "What dependencies do we have?"

  # Continue previous session
  ${APP_NAME} --continue "What did we discuss?"

  # Start a named session
  ${APP_NAME} --name "Refactor auth module"

  # Use different model
  ${APP_NAME} --provider openai --model gpt-4o-mini "Help me refactor this code"

  # Use model with provider prefix (no --provider needed)
  ${APP_NAME} --model openai/gpt-4o "Help me refactor this code"

  # Use model with thinking level shorthand
  ${APP_NAME} --model sonnet:high "Solve this complex problem"

  # Limit model cycling to specific models
  ${APP_NAME} --models claude-sonnet,claude-haiku,gpt-4o

  # Limit to a specific provider with glob pattern
  ${APP_NAME} --models "github-copilot/*"

  # Cycle models with fixed thinking levels
  ${APP_NAME} --models sonnet:high,haiku:low

  # Start with a specific thinking level
  ${APP_NAME} --thinking high "Solve this complex problem"

  # Read-only mode (no file modifications possible)
  ${APP_NAME} --tools read,grep,find,ls -p "Review the code in src/"

  # Disable one tool while keeping the rest available
  ${APP_NAME} --exclude-tools ask_question

  # Export a session file to HTML
  ${APP_NAME} --export ~/${CONFIG_DIR_NAME}/agent/sessions/--path--/session.jsonl
  ${APP_NAME} --export session.jsonl output.html

${chalk.bold("Environment Variables:")}
  ANTHROPIC_API_KEY                - Anthropic Claude API key
  ANTHROPIC_OAUTH_TOKEN            - Anthropic OAuth token (alternative to API key)
  ANT_LING_API_KEY                 - Ant Ling API key
  OPENAI_API_KEY                   - OpenAI GPT API key
  AZURE_OPENAI_API_KEY             - Azure OpenAI API key
  AZURE_OPENAI_BASE_URL            - Azure OpenAI/Cognitive Services base URL (e.g. https://{resource}.openai.azure.com)
  AZURE_OPENAI_RESOURCE_NAME       - Azure OpenAI resource name (alternative to base URL)
  AZURE_OPENAI_API_VERSION         - Azure OpenAI API version (default: v1)
  AZURE_OPENAI_DEPLOYMENT_NAME_MAP - Azure OpenAI model=deployment map (comma-separated)
  DEEPSEEK_API_KEY                 - DeepSeek API key
  NVIDIA_API_KEY                   - NVIDIA NIM API key
  GEMINI_API_KEY                   - Google Gemini API key
  GROQ_API_KEY                     - Groq API key
  CEREBRAS_API_KEY                 - Cerebras API key
  XAI_API_KEY                      - xAI Grok API key
  FIREWORKS_API_KEY                - Fireworks API key
  TOGETHER_API_KEY                 - Together AI API key
  OPENROUTER_API_KEY               - OpenRouter API key
  AI_GATEWAY_API_KEY               - Vercel AI Gateway API key
  ZAI_API_KEY                      - ZAI Coding Plan API key (Global)
  ZAI_CODING_CN_API_KEY            - ZAI Coding Plan API key (China)
  MISTRAL_API_KEY                  - Mistral API key
  MINIMAX_API_KEY                  - MiniMax API key
  MOONSHOT_API_KEY                 - Moonshot AI API key
  OPENCODE_API_KEY                 - OpenCode Zen/OpenCode Go API key
  KIMI_API_KEY                     - Kimi For Coding API key
  CLOUDFLARE_API_KEY               - Cloudflare API token (Workers AI and AI Gateway)
  CLOUDFLARE_ACCOUNT_ID            - Cloudflare account id (required for both)
  CLOUDFLARE_GATEWAY_ID            - Cloudflare AI Gateway slug (required for AI Gateway)
  XIAOMI_API_KEY                   - Xiaomi MiMo API key (api.xiaomimimo.com billing)
  XIAOMI_TOKEN_PLAN_CN_API_KEY     - Xiaomi MiMo Token Plan API key (China region)
  XIAOMI_TOKEN_PLAN_AMS_API_KEY    - Xiaomi MiMo Token Plan API key (Amsterdam region)
  XIAOMI_TOKEN_PLAN_SGP_API_KEY    - Xiaomi MiMo Token Plan API key (Singapore region)
  AWS_PROFILE                      - AWS profile for Amazon Bedrock
  AWS_ACCESS_KEY_ID                - AWS access key for Amazon Bedrock
  AWS_SECRET_ACCESS_KEY            - AWS secret key for Amazon Bedrock
  AWS_BEARER_TOKEN_BEDROCK         - Bedrock API key (bearer token)
  AWS_REGION                       - AWS region for Amazon Bedrock (e.g., us-east-1)
  ${ENV_AGENT_DIR.padEnd(32)} - Config directory (default: ~/${CONFIG_DIR_NAME}/agent)
  ${ENV_SESSION_DIR.padEnd(32)} - Session storage directory (overridden by --session-dir)
  METIS_PACKAGE_DIR                   - Override package directory (for Nix/Guix store paths)
  METIS_OFFLINE                       - Disable startup network operations when set to 1/true/yes
  METIS_TELEMETRY                     - Override install telemetry when set to 1/true/yes or 0/false/no
  METIS_SHARE_VIEWER_URL              - Base URL for /share command (default: https://metis.dev/session/)

${chalk.bold("Built-in Tool Names:")}
  read   - Read file contents
  bash   - Execute bash commands
  edit   - Edit files with find/replace
  write  - Write files (creates/overwrites)
  grep   - Search file contents (read-only, off by default)
  find   - Find files by glob pattern (read-only, off by default)
  ls     - List directory contents (read-only, off by default)
`);
}


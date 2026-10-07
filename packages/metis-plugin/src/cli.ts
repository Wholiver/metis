import { resolve } from "node:path";
import { loadContracts, assertProviderSupported } from "./contracts.ts";
import { Projector } from "./projector.ts";
import { OpenCodeAdapter } from "./adapters/opencode.ts";
import { CodexAdapter, parseCodexEnvelope } from "./adapters/codex.ts";
import { DeepSeekAdapter } from "./adapters/deepseek.ts";
import { ExternalController } from "./controller.ts";

export interface ParsedArgs {
  command: string;
  provider?: string;
  target?: string;
  mission?: string;
  root?: string;
  model?: string;
  thinking?: boolean;
  dryRun: boolean;
  verbose: boolean;
  json: boolean;
  help: boolean;
  version: boolean;
  path?: "direct" | "light" | "roadmap" | "auto";
  concurrency?: "tokensaver" | "wide" | "custom";
  maxSubs?: number;
}

/** Strip path= / concurrency controls that may appear after `--` before the mission text. */
export function extractMissionControls(raw: string): {
  mission: string;
  path?: ParsedArgs["path"];
  concurrency?: ParsedArgs["concurrency"];
  maxSubs?: number;
} {
  const tokens = raw.trim().split(/\s+/).filter(Boolean);
  let path: ParsedArgs["path"] | undefined;
  let concurrency: ParsedArgs["concurrency"] | undefined;
  let maxSubs: number | undefined;
  const missionTokens: string[] = [];

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i]!;
    if (tok.startsWith("path=")) {
      const v = tok.slice("path=".length) as ParsedArgs["path"];
      if (v === "direct" || v === "light" || v === "roadmap" || v === "auto") path = v;
      continue;
    }
    if (tok === "--concurrency" && tokens[i + 1]) {
      const v = tokens[++i] as ParsedArgs["concurrency"];
      if (v === "tokensaver" || v === "wide" || v === "custom") concurrency = v;
      continue;
    }
    if (tok.startsWith("--concurrency=")) {
      const v = tok.slice("--concurrency=".length) as ParsedArgs["concurrency"];
      if (v === "tokensaver" || v === "wide" || v === "custom") concurrency = v;
      continue;
    }
    if (tok === "--max-subs" && tokens[i + 1]) {
      maxSubs = Number(tokens[++i]);
      continue;
    }
    if (tok.startsWith("--max-subs=")) {
      maxSubs = Number(tok.slice("--max-subs=".length));
      continue;
    }
    missionTokens.push(tok);
  }

  return {
    mission: missionTokens.join(" ").trim(),
    path,
    concurrency,
    maxSubs: Number.isFinite(maxSubs) ? maxSubs : undefined,
  };
}

export function parseCliArgs(args: string[]): ParsedArgs {
  const result: ParsedArgs = {
    command: "",
    dryRun: false,
    verbose: false,
    json: false,
    help: false,
    version: false,
  };

  // If invoked with $metis envelope format or envelope string
  const firstArg = args[0]?.trim() || "";
  const joinedArgs = args.join(" ").trim();
  if (firstArg.startsWith("$metis") || (joinedArgs.startsWith("$metis") || (joinedArgs.includes("target=") && joinedArgs.includes("mission=")))) {
    try {
      const parsedEnvelope = parseCodexEnvelope(joinedArgs);
      if (parsedEnvelope.targetDir && parsedEnvelope.mission) {
        result.command = parsedEnvelope.command;
        result.provider = "codex";
        result.target = parsedEnvelope.targetDir;
        result.mission = parsedEnvelope.mission;
        result.model = parsedEnvelope.model;
        const rootIdx = args.findIndex(a => a === "--root" || a === "-r");
        if (rootIdx !== -1 && args[rootIdx + 1]) {
          result.root = args[rootIdx + 1];
        } else {
          const rootArg = args.find(a => a.startsWith("--root="));
          if (rootArg) result.root = rootArg.slice(rootArg.indexOf("=") + 1);
        }
        if (parsedEnvelope.dryRun) result.dryRun = true;
        if (args.includes("--json")) result.json = true;
        if (args.includes("--verbose")) result.verbose = true;
        return result;
      }
    } catch {
      // Fall through to normal arg parsing
    }
  }

  const positional: string[] = [];
  let i = 0;

  while (i < args.length) {
    const arg = args[i];

    if (arg === "--") {
      // Everything after -- is controls + mission
      const extracted = extractMissionControls(args.slice(i + 1).join(" "));
      result.mission = extracted.mission;
      if (extracted.path) result.path = extracted.path;
      if (extracted.concurrency) result.concurrency = extracted.concurrency;
      if (extracted.maxSubs !== undefined) result.maxSubs = extracted.maxSubs;
      break;
    }

    if (arg.startsWith("path=")) {
      const v = arg.slice("path=".length);
      if (v === "direct" || v === "light" || v === "roadmap" || v === "auto") result.path = v;
    } else if (arg === "--concurrency" && i + 1 < args.length) {
      i++;
      const v = args[i];
      if (v === "tokensaver" || v === "wide" || v === "custom") result.concurrency = v;
    } else if (arg.startsWith("--concurrency=")) {
      const v = arg.slice("--concurrency=".length);
      if (v === "tokensaver" || v === "wide" || v === "custom") result.concurrency = v;
    } else if (arg === "--max-subs" && i + 1 < args.length) {
      i++;
      result.maxSubs = Number(args[i]);
    } else if (arg.startsWith("--max-subs=")) {
      result.maxSubs = Number(arg.slice("--max-subs=".length));
    } else if (arg === "--help" || arg === "-h") {
      result.help = true;
    } else if (arg === "--version" || arg === "-v") {
      result.version = true;
    } else if (arg === "--dry-run") {
      result.dryRun = true;
    } else if (arg === "--verbose") {
      result.verbose = true;
    } else if (arg === "--json") {
      result.json = true;
    } else if (arg === "--thinking") {
      result.thinking = true;
    } else if (arg === "--model" || arg === "-m") {
      i++;
      result.model = args[i];
    } else if (arg.startsWith("--model=")) {
      result.model = arg.slice(arg.indexOf("=") + 1);
    } else if (arg === "--target" || arg === "-t") {
      i++;
      result.target = args[i];
    } else if (arg === "--root" || arg === "-r") {
      i++;
      result.root = args[i];
    } else if (arg.startsWith("--target=")) {
      result.target = arg.slice(arg.indexOf("=") + 1);
    } else if (arg.startsWith("--root=")) {
      result.root = arg.slice(arg.indexOf("=") + 1);
    } else if (!arg.startsWith("-")) {
      positional.push(arg);
    }
    i++;
  }

  result.command = positional[0] || "";
  result.provider = positional[1];

  // If mission not found after --, check if positional args 2+ are mission
  if (!result.mission && positional.length > 2) {
    const extracted = extractMissionControls(positional.slice(2).join(" "));
    result.mission = extracted.mission;
    if (extracted.path) result.path = extracted.path;
    if (extracted.concurrency) result.concurrency = extracted.concurrency;
    if (extracted.maxSubs !== undefined) result.maxSubs = extracted.maxSubs;
  }

  return result;
}

export function printHelp() {
  console.log(`
Metis 插件版 — Lifecycle CLI

USAGE:
  metis-plugin <command> [provider] [options]

COMMANDS:
  install [provider]    Install Metis launcher, roles, and private bundle to host
  activate <provider>   Execute mission via host-isolated External Controller
  doctor [provider]     Verify host installation, file integrity, and receipt hashes
  uninstall [provider]  Cleanly remove Metis plugin installation and receipt
  project [provider]    Generate host projections from contracts to agents/ directory

PROVIDERS:
  opencode              OpenCode host (commands/metis.md + subagents)
  codex                 Codex host (skills/metis/SKILL.md + TOML roles)
  deepseek              DeepSeek Harness (skills/metis/SKILL.md + Cordis bridge)

OPTIONS:
  --target, -t <path>   Workspace directory for activation (required for activate)
  --root, -r <path>     Override host installation directory (METIS_PLUGIN_INSTALL_ROOT)
  --dry-run             Validate plan without executing changes
  --verbose             Show detailed execution logs
  --json                Emit output as JSON
  path=direct|light|roadmap|auto
                        Lock route (T0 / T1 / T2-T3 / auto) after --
  --concurrency tokensaver|wide|custom
                        Parallel implementer lane limit (T3)
  --max-subs N          Cap for --concurrency custom (also after --)
  --help, -h            Show this help text
  --version, -v         Show version

EXAMPLES:
  metis-plugin install opencode
  metis-plugin activate opencode --target /path/to/project -- "Fix authentication token leak"
  metis-plugin activate codex --target /path/to/project -- path=light --concurrency tokensaver "add retries"
  metis-plugin doctor codex
  metis-plugin activate deepseek --target /path/to/project -- "Build customer search endpoint"
`);
}

export async function runCli(argv: string[] = process.argv.slice(2)): Promise<number> {
  const parsed = parseCliArgs(argv);

  if (parsed.help || (!parsed.command && !parsed.version)) {
    printHelp();
    return 0;
  }

  if (parsed.version) {
    console.log("metis-plugin v1.0.0 (Metis 插件版)");
    return 0;
  }

  const contracts = loadContracts();
  const controller = new ExternalController(contracts);

  function getAdapters(providerId?: string) {
    if (providerId) {
      assertProviderSupported(providerId, contracts.providers);
      return [controller.getAdapter(providerId)];
    }
    return [
      new OpenCodeAdapter(contracts),
      new CodexAdapter(contracts),
      new DeepSeekAdapter(contracts),
    ];
  }

  try {
    switch (parsed.command) {
      case "install": {
        const adapters = getAdapters(parsed.provider);
        const receipts = [];
        for (const adapter of adapters) {
          const receipt = await adapter.install(parsed.root);
          receipts.push(receipt);
          if (!parsed.json) {
            console.log(`✅ Successfully installed Metis 插件版 for ${adapter.providerId} at ${receipt.installRoot}`);
            console.log(`   Launcher: ${receipt.launcherPath}`);
            console.log(`   Roles: ${receipt.roles.join(", ")}`);
            console.log(`   Files: ${receipt.files.length} registered in receipt`);
          }
        }
        if (parsed.json) {
          console.log(JSON.stringify({ status: "success", receipts }, null, 2));
        }
        return 0;
      }

      case "doctor": {
        const isSpecific = !!parsed.provider;
        const adapters = getAdapters(parsed.provider);
        let allOk = true;
        let anyInstalled = false;
        const results = [];

        for (const adapter of adapters) {
          const doc = await adapter.doctor(parsed.root);
          results.push(doc);
          if (doc.installed) anyInstalled = true;

          if (!parsed.json) {
            console.log(`\n--- Metis Doctor: ${adapter.providerId.toUpperCase()} ---`);
            console.log(`Host Directory: ${doc.installRoot} (${doc.detected ? "Found" : "Not Found"})`);
            console.log(`Installed:      ${doc.installed ? "Yes" : "No"}`);
            console.log(`Receipt Hash:   ${doc.bundleHashValid ? "Valid" : "Invalid/Missing"}`);
            console.log(`Verification:   ${doc.verified ? "PASSED" : "FAILED"}`);
            if (doc.details.activeModel) {
              console.log(`Active Model:   ${doc.details.activeModel} (${doc.details.activeModelSource || "detected"})`);
            }

            if (doc.warnings.length > 0) {
              console.log("Warnings:");
              doc.warnings.forEach(w => console.log(`  ⚠️  ${w}`));
            }
            if (doc.errors.length > 0) {
              console.log("Errors:");
              doc.errors.forEach(e => console.log(`  ❌ ${e}`));
            }
          }

          if (isSpecific) {
            if (!doc.verified) {
              allOk = false;
            }
          } else {
            if (doc.installed && !doc.verified) {
              allOk = false;
            }
          }
        }

        if (!isSpecific && !anyInstalled) {
          allOk = false;
        }

        if (parsed.json) {
          console.log(JSON.stringify({ status: allOk ? "ok" : "failed", results }, null, 2));
        }

        return allOk ? 0 : 1;
      }

      case "uninstall": {
        const adapters = getAdapters(parsed.provider);
        const uninstalled = [];
        for (const adapter of adapters) {
          const res = await adapter.uninstall(parsed.root);
          uninstalled.push(res);
          if (!parsed.json) {
            console.log(`🗑️  Uninstalled Metis 插件版 from ${adapter.providerId} (${res.removedFiles.length} files removed)`);
          }
        }
        if (parsed.json) {
          console.log(JSON.stringify({ status: "success", uninstalled }, null, 2));
        }
        return 0;
      }

      case "project": {
        const projector = new Projector(contracts);
        const baseOut = parsed.root ? resolve(parsed.root) : resolve(process.cwd(), "agents");
        const results = projector.projectAll(baseOut);

        if (!parsed.json) {
          console.log(`✨ Projected native host files into ${baseOut}:`);
          for (const [p, res] of Object.entries(results)) {
            console.log(`   ${p}: ${res.files.length} files generated`);
          }
        } else {
          console.log(JSON.stringify({ status: "success", outputDir: baseOut, results }, null, 2));
        }
        return 0;
      }

      case "activate": {
        if (!parsed.provider) {
          console.error("Error: Provider must be specified for activate (e.g. metis-plugin activate opencode)");
          return 1;
        }
        if (!parsed.target) {
          console.error("Error: --target <directory> is required for activate");
          return 1;
        }
        if (!parsed.mission) {
          console.error("Error: Mission description must be provided after -- (e.g. -- \"My mission\")");
          return 1;
        }

        const res = await controller.activate({
          provider: parsed.provider,
          targetDir: parsed.target,
          mission: parsed.mission,
          model: parsed.model,
          thinking: parsed.thinking,
          customRoot: parsed.root,
          dryRun: parsed.dryRun,
          verbose: parsed.verbose,
          path: parsed.path,
          concurrency: parsed.concurrency,
          maxSubs: parsed.maxSubs,
        });

        if (parsed.json) {
          console.log(JSON.stringify(res, null, 2));
        } else {
          console.log(`\n🚀 [Metis 插件版] Activation Complete:`);
          console.log(`Provider:   ${res.provider}`);
          console.log(`Target:     ${res.targetDir}`);
          console.log(`Model:      ${res.resolvedModel.model} (${res.resolvedModel.source})`);
          console.log(`Route:      ${res.route}`);
          console.log(`Framework:  ${res.framework}`);
          console.log(`Success:    ${res.success ? "YES" : "NO"}`);
          console.log(`Summary:    ${res.summary}`);
          console.log(`Gates Executed:`);
          for (const g of res.gateEvidence) {
            console.log(`  - Gate ${g.gate} (${g.role}): ${g.status}`);
          }
        }

        return res.success ? 0 : 1;
      }

      default:
        console.error(`Unknown command: "${parsed.command}". Run "metis-plugin --help" for available commands.`);
        return 1;
    }
  } catch (err: any) {
    if (parsed.json) {
      console.log(JSON.stringify({ status: "error", error: err.message }, null, 2));
    } else {
      console.error(`❌ Error: ${err.message}`);
    }
    return 1;
  }
}

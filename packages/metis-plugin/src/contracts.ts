import { readFileSync, existsSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface RoleContract {
  id: string;
  name: string;
  roleType: "orchestrator" | "worker" | "checker";
  description: string;
  tools: string[];
  nativeDispatchAllowed: boolean;
  codex: {
    name: string;
    sandbox_mode: "read-only" | "workspace-write";
  };
  opencode: {
    mode: "subagent";
    permission: {
      task: "deny";
      skill: "deny";
      bash: "allow" | "deny";
      write: "allow" | "deny";
      edit: "allow" | "deny";
      read: "allow";
    };
  };
  deepseek: {
    id: string;
    cordisPreset: boolean;
    toolFilter: string[];
  };
  systemPrompt: string;
}

export interface FrameworkContract {
  id: string;
  name: string;
  category: string;
  tier: string;
  description: string;
}

export interface GateContract {
  id: string;
  name: string;
  stage: string;
  requiredRole: string;
  description: string;
}

export interface RouteContract {
  tier: string;
  name: string;
  description: string;
  sequence: string[];
  notes?: string;
}

export interface ProviderContract {
  id: string;
  name: string;
  supported: boolean;
  priority?: number;
  envOverride?: string;
  defaultHomeEnv?: string;
  defaultSubpath?: string;
  fallbackPath?: string;
  launcherType?: "command" | "skill";
  launcherPath?: string;
  rolesDir?: string;
  roleFormat?: "markdown" | "toml";
  bundleDir?: string;
  receiptFile?: string;
  nativeDispatchAllowed?: boolean;
  deniedPermissions?: string[];
  modelHandling?: string;
  sandboxModeByRoleType?: Record<string, "read-only" | "workspace-write">;
  envelopeStyle?: string;
  presetsDir?: string;
  cordisBridgeDir?: string;
  bridgeRequired?: boolean;
  reason?: string;
}

export interface ContractsBundle {
  roles: RoleContract[];
  allowlistedMetisRoles: string[];
  frameworks: FrameworkContract[];
  gates: GateContract[];
  routes: RouteContract[];
  providers: Record<string, ProviderContract>;
  bundleHash: string;
}

export function findContractsDir(explicitDir?: string): string {
  if (explicitDir && existsSync(explicitDir)) {
    return explicitDir;
  }
  if (process.env.METIS_CONTRACTS_DIR && existsSync(process.env.METIS_CONTRACTS_DIR)) {
    return process.env.METIS_CONTRACTS_DIR;
  }
  // Try relative to this file
  const candidate1 = resolve(__dirname, "../../../contracts");
  if (existsSync(candidate1)) return candidate1;
  const candidate2 = resolve(__dirname, "../contracts");
  if (existsSync(candidate2)) return candidate2;
  const candidate3 = resolve(process.cwd(), "contracts");
  if (existsSync(candidate3)) return candidate3;
  throw new Error(`Cannot locate contracts directory. Set METIS_CONTRACTS_DIR or run from repo root.`);
}

export function loadContracts(explicitDir?: string): ContractsBundle {
  const dir = findContractsDir(explicitDir);

  const rolesRaw = JSON.parse(readFileSync(join(dir, "roles.json"), "utf-8"));
  const frameworksRaw = JSON.parse(readFileSync(join(dir, "frameworks.json"), "utf-8"));
  const gatesRaw = JSON.parse(readFileSync(join(dir, "gates.json"), "utf-8"));
  const routesRaw = JSON.parse(readFileSync(join(dir, "routes.json"), "utf-8"));
  const providersRaw = JSON.parse(readFileSync(join(dir, "providers.json"), "utf-8"));

  const hash = createHash("sha256");
  hash.update(JSON.stringify(rolesRaw));
  hash.update(JSON.stringify(frameworksRaw));
  hash.update(JSON.stringify(gatesRaw));
  hash.update(JSON.stringify(routesRaw));
  hash.update(JSON.stringify(providersRaw));
  const bundleHash = hash.digest("hex");

  return {
    roles: rolesRaw.activeRoles,
    allowlistedMetisRoles: rolesRaw.allowlistedMetisRoles || [],
    frameworks: frameworksRaw.frameworks,
    gates: gatesRaw.gates,
    routes: routesRaw.routes,
    providers: providersRaw.providers,
    bundleHash,
  };
}

export function assertProviderSupported(providerId: string, providers: Record<string, ProviderContract>): ProviderContract {
  const provider = providers[providerId];
  if (!provider) {
    throw new Error(`PROVIDER_UNSUPPORTED: Unknown provider "${providerId}". In-scope hosts are: opencode, codex, deepseek.`);
  }
  if (!provider.supported) {
    throw new Error(provider.reason || `PROVIDER_UNSUPPORTED: Provider "${providerId}" is out of scope for Metis 插件版 v1.`);
  }
  return provider;
}

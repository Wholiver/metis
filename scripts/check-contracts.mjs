#!/usr/bin/env node

/**
 * check-contracts.mjs
 * Validates that contracts/*.json match Metis BUILTIN_* definitions and 16 frameworks,
 * and fails if any contract drift is detected.
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, "..");

const rolesContractPath = join(rootDir, "contracts", "roles.json");
const frameworksContractPath = join(rootDir, "contracts", "frameworks.json");
const gatesContractPath = join(rootDir, "contracts", "gates.json");
const routesContractPath = join(rootDir, "contracts", "routes.json");
const providersContractPath = join(rootDir, "contracts", "providers.json");

const agentDefSourcePath = join(rootDir, "src", "core", "agent-definition.ts");
const frameworksSourcePath = join(rootDir, "src", "core", "performance-frameworks.ts");

const errors = [];

function checkFile(filePath, label) {
  if (!existsSync(filePath)) {
    errors.push(`Missing required file: ${label} at ${filePath}`);
    return false;
  }
  return true;
}

if (!checkFile(rolesContractPath, "contracts/roles.json") ||
    !checkFile(frameworksContractPath, "contracts/frameworks.json") ||
    !checkFile(gatesContractPath, "contracts/gates.json") ||
    !checkFile(routesContractPath, "contracts/routes.json") ||
    !checkFile(providersContractPath, "contracts/providers.json") ||
    !checkFile(agentDefSourcePath, "src/core/agent-definition.ts") ||
    !checkFile(frameworksSourcePath, "src/core/performance-frameworks.ts")) {
  console.error("Contract check failed due to missing files:\n", errors.join("\n"));
  process.exit(1);
}

// 1. Validate Roles against Metis BUILTIN_*
const rolesContract = JSON.parse(readFileSync(rolesContractPath, "utf-8"));
const agentDefSource = readFileSync(agentDefSourcePath, "utf-8");

// Parse BUILTIN_* exports from agent-definition.ts
const builtinRegex = /export\s+const\s+BUILTIN_([A-Z0-9_]+)\s*:\s*AgentDefinition\s*=\s*\{[^}]*name:\s*"([^"]+)"/g;
const metisBuiltinNames = new Set();
let match;
while ((match = builtinRegex.exec(agentDefSource)) !== null) {
  metisBuiltinNames.add(match[2]);
}

const actualActiveRoleIds = rolesContract.activeRoles.map(r => r.id);

if (metisBuiltinNames.size !== 26) {
  errors.push(`Expected Metis agent-definition.ts to contain 26 BUILTIN_* roles, found ${metisBuiltinNames.size}`);
}

for (const builtin of metisBuiltinNames) {
  if (!actualActiveRoleIds.includes(builtin)) {
    errors.push(`Drift in roles.json: Missing active role "${builtin}"`);
  }
}

for (const active of actualActiveRoleIds) {
  if (!metisBuiltinNames.has(active)) {
    errors.push(`Drift in roles.json: Active role "${active}" does not exist in Metis BUILTIN_*`);
  }
}


// 2. Validate Frameworks against ALL_PERFORMANCE_FRAMEWORKS
const frameworksContract = JSON.parse(readFileSync(frameworksContractPath, "utf-8"));
const frameworksSource = readFileSync(frameworksSourcePath, "utf-8");

// Extract framework ids from performance-frameworks.ts
const fwRegex = /export\s+const\s+FRAMEWORK_([A-Z0-9_]+)\s*:\s*PerformanceFramework\s*=\s*\{[^}]*id:\s*"([^"]+)"/g;
const metisFrameworkIds = new Set();
while ((match = fwRegex.exec(frameworksSource)) !== null) {
  metisFrameworkIds.add(match[2]);
}

const contractFwIds = new Set(frameworksContract.frameworks.map(f => f.id));

if (metisFrameworkIds.size !== 16) {
  errors.push(`Expected Metis performance-frameworks.ts to contain 16 frameworks, found ${metisFrameworkIds.size}`);
}

for (const fwId of metisFrameworkIds) {
  if (!contractFwIds.has(fwId)) {
    errors.push(`Drift in frameworks.json: Missing framework "${fwId}"`);
  }
}

for (const fwId of contractFwIds) {
  if (!metisFrameworkIds.has(fwId)) {
    errors.push(`Drift in frameworks.json: Unexpected framework "${fwId}" not in Metis frameworks`);
  }
}

// 3. Validate Gates and Routes schemas
const gatesContract = JSON.parse(readFileSync(gatesContractPath, "utf-8"));
if (!Array.isArray(gatesContract.gates) || gatesContract.gates.length === 0) {
  errors.push("Invalid gates.json: 'gates' must be a non-empty array");
}

const expectedGateRoles = {
  G2: "scope-coordinator",
  "G3.5": "depth-prober",
  G5: "reviewer",
  G6: "verifier",
  G7: "juror",
  sweep: "sweeper",
  "goal-check": "goal-checker",
};
for (const [gateId, role] of Object.entries(expectedGateRoles)) {
  const gate = gatesContract.gates.find((g) => g.id === gateId);
  if (!gate) {
    errors.push(`gates.json missing gate ${gateId}`);
  } else if (gate.requiredRole !== role) {
    errors.push(`gates.json ${gateId} requiredRole must be ${role}, got ${gate.requiredRole}`);
  }
}

const routesContract = JSON.parse(readFileSync(routesContractPath, "utf-8"));
if (!Array.isArray(routesContract.routes) || routesContract.routes.length === 0) {
  errors.push("Invalid routes.json: 'routes' must be a non-empty array");
}
const routeTiers = new Set(routesContract.routes.map((r) => r.tier));
for (const tier of ["fast-path", "T0", "T1", "T2", "T3", "debug"]) {
  if (!routeTiers.has(tier)) errors.push(`routes.json missing tier ${tier}`);
}

// Role prompts must use real newlines (not literal \\n only)
for (const role of rolesContract.activeRoles) {
  if (typeof role.systemPrompt !== "string" || !role.systemPrompt.includes("\n")) {
    errors.push(`roles.json ${role.id} systemPrompt must contain real newlines after JSON parse`);
  }
}

// 4. Validate Providers
const providersContract = JSON.parse(readFileSync(providersContractPath, "utf-8"));
const providers = providersContract.providers;
if (!providers.opencode || !providers.codex || !providers.deepseek) {
  errors.push("Invalid providers.json: Must specify 'opencode', 'codex', and 'deepseek'");
}
if (!providers.opencode.supported || !providers.codex.supported || !providers.deepseek.supported) {
  errors.push("Supported providers in providers.json must include opencode, codex, and deepseek");
}
if (providers.cursor && providers.cursor.supported !== false) {
  errors.push("Out-of-scope host 'cursor' must have supported: false");
}
if (providers.claude && providers.claude.supported !== false) {
  errors.push("Out-of-scope host 'claude' must have supported: false");
}

if (errors.length > 0) {
  console.error("❌ Contracts drift check FAILED with errors:");
  for (const err of errors) {
    console.error(` - ${err}`);
  }
  process.exit(1);
}

console.log("✅ Contracts verification PASSED: Roles, 16 frameworks, gates, routes, and providers are aligned.");

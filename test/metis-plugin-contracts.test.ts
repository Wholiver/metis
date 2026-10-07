import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { loadContracts, assertProviderSupported } from "../packages/metis-plugin/src/contracts.ts";
import { BUILTIN_COORDINATOR, BUILTIN_PLANNER, BUILTIN_IMPLEMENTER, BUILTIN_REVIEWER, BUILTIN_VERIFIER, BUILTIN_AGENTS } from "../src/core/agent-definition.ts";
import { ALL_PERFORMANCE_FRAMEWORKS } from "../src/core/performance-frameworks.ts";

describe("Metis 插件版 - P0 Contracts (Source of Truth)", () => {
  const contracts = loadContracts();

  it("should have all 26 native active roles defined", () => {
    expect(contracts.roles).toHaveLength(26);
    const activeIds = contracts.roles.map(r => r.id);
    expect(activeIds).toContain("coordinator");
    expect(activeIds).toContain("planner");
    expect(activeIds).toContain("implementer");
    expect(activeIds).toContain("reviewer");
    expect(activeIds).toContain("verifier");
  });

  it("should align active roles with Metis BUILTIN_* definitions", () => {
    const coordinator = contracts.roles.find(r => r.id === "coordinator");
    expect(coordinator).toBeDefined();
    expect(coordinator!.roleType).toBe("orchestrator");
    expect(BUILTIN_COORDINATOR.name).toBe("coordinator");

    const planner = contracts.roles.find(r => r.id === "planner");
    expect(planner).toBeDefined();
    expect(planner!.roleType).toBe("checker");
    expect(BUILTIN_PLANNER.name).toBe("planner");

    const implementer = contracts.roles.find(r => r.id === "implementer");
    expect(implementer).toBeDefined();
    expect(implementer!.roleType).toBe("worker");
    expect(BUILTIN_IMPLEMENTER.name).toBe("implementer");

    const reviewer = contracts.roles.find(r => r.id === "reviewer");
    expect(reviewer).toBeDefined();
    expect(reviewer!.roleType).toBe("checker");
    expect(BUILTIN_REVIEWER.name).toBe("reviewer");

    const verifier = contracts.roles.find(r => r.id === "verifier");
    expect(verifier).toBeDefined();
    expect(verifier!.roleType).toBe("checker");
    expect(BUILTIN_VERIFIER.name).toBe("verifier");
  });

  it("should allowlist all other Metis BUILTIN_AGENTS", () => {
    const activeIds = new Set(contracts.roles.map(r => r.id));
    const allowlisted = new Set(contracts.allowlistedMetisRoles);

    for (const agent of BUILTIN_AGENTS) {
      const isHandled = activeIds.has(agent.name) || allowlisted.has(agent.name);
      expect(isHandled, `Metis builtin agent "${agent.name}" must be active or allowlisted`).toBe(true);
    }
  });

  it("should include exactly 16 performance frameworks matching Metis ALL_PERFORMANCE_FRAMEWORKS", () => {
    expect(contracts.frameworks).toHaveLength(16);
    expect(ALL_PERFORMANCE_FRAMEWORKS).toHaveLength(16);

    const contractFwMap = new Map(contracts.frameworks.map(f => [f.id, f]));
    for (const builtinFw of ALL_PERFORMANCE_FRAMEWORKS) {
      const fw = contractFwMap.get(builtinFw.id);
      expect(fw, `Framework "${builtinFw.id}" must exist in frameworks contract`).toBeDefined();
      expect(fw!.name).toBe(builtinFw.name);
      expect(fw!.category).toBe(builtinFw.category);
    }
  });

  it("should have valid quality gates defined", () => {
    expect(contracts.gates.length).toBeGreaterThanOrEqual(10);
    const gateIds = contracts.gates.map(g => g.id);
    expect(gateIds).toContain("G0");
    expect(gateIds).toContain("G1");
    expect(gateIds).toContain("G2");
    expect(gateIds).toContain("G3.5");
    expect(gateIds).toContain("G4");
    expect(gateIds).toContain("G5");
    expect(gateIds).toContain("G6");
    expect(gateIds).toContain("G7");
    expect(gateIds).toContain("sweep");
    expect(gateIds).toContain("goal-check");
  });

  it("should align gate requiredRole with Performance runtime closers", () => {
    const byId = new Map(contracts.gates.map((g) => [g.id, g.requiredRole]));
    expect(byId.get("G2")).toBe("scope-coordinator");
    expect(byId.get("G3.5")).toBe("depth-prober");
    expect(byId.get("G5")).toBe("reviewer");
    expect(byId.get("G6")).toBe("verifier");
    expect(byId.get("G7")).toBe("juror");
    expect(byId.get("sweep")).toBe("sweeper");
    expect(byId.get("goal-check")).toBe("goal-checker");
  });

  it("should keep role systemPrompt byte-identical to BUILTIN_AGENTS", () => {
    const byName = new Map(BUILTIN_AGENTS.map((a) => [a.name, a]));
    for (const role of contracts.roles) {
      const builtin = byName.get(role.id);
      expect(builtin, role.id).toBeDefined();
      expect(role.systemPrompt).toBe(builtin!.systemPrompt);
      expect(role.systemPrompt.includes("\n"), `${role.id} must have real newlines`).toBe(true);
    }
    const depth = contracts.roles.find((r) => r.id === "depth-prober")!;
    const researcher = contracts.roles.find((r) => r.id === "researcher")!;
    expect(depth.systemPrompt.length).toBeGreaterThan(3000);
    expect(researcher.systemPrompt.length).toBeGreaterThan(3000);
    expect(contracts.roles.find((r) => r.id === "coordinator")!.systemPrompt).toContain("L1 orchestration");
  });

  it("should have valid routes defined", () => {
    const routeTiers = contracts.routes.map(r => r.tier);
    expect(routeTiers).toContain("fast-path");
    expect(routeTiers).toContain("T0");
    expect(routeTiers).toContain("T1");
    expect(routeTiers).toContain("T2");
    expect(routeTiers).toContain("T3");
    expect(routeTiers).toContain("debug");
  });

  it("should enforce scope lock on providers (Codex, OpenCode, DeepSeek supported; others unsupported)", () => {
    expect(contracts.providers.opencode.supported).toBe(true);
    expect(contracts.providers.codex.supported).toBe(true);
    expect(contracts.providers.deepseek.supported).toBe(true);

    expect(contracts.providers.cursor?.supported).toBe(false);
    expect(contracts.providers.claude?.supported).toBe(false);
    expect(contracts.providers.vscode?.supported).toBe(false);

    expect(() => assertProviderSupported("cursor", contracts.providers)).toThrow(/PROVIDER_UNSUPPORTED/);
    expect(() => assertProviderSupported("claude", contracts.providers)).toThrow(/PROVIDER_UNSUPPORTED/);
    expect(() => assertProviderSupported("vscode", contracts.providers)).toThrow(/PROVIDER_UNSUPPORTED/);
    expect(() => assertProviderSupported("unknown_host", contracts.providers)).toThrow(/PROVIDER_UNSUPPORTED/);
  });
});

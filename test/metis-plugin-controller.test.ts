import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";
import { ExternalController } from "../packages/metis-plugin/src/controller.ts";
import { OpenCodeAdapter } from "../packages/metis-plugin/src/adapters/opencode.ts";

describe("Metis 插件版 - External Controller & Orchestration Governance", () => {
  let testRoot: string;
  let targetDir: string;
  let controller: ExternalController;
  let opencodeAdapter: OpenCodeAdapter;

  beforeEach(async () => {
    testRoot = join(tmpdir(), `metis-test-ctrl-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    targetDir = join(tmpdir(), `metis-test-ctrl-target-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(testRoot, { recursive: true });
    mkdirSync(targetDir, { recursive: true });

    controller = new ExternalController();
    opencodeAdapter = new OpenCodeAdapter();
    await opencodeAdapter.install(testRoot);
  });

  afterEach(() => {
    rmSync(testRoot, { recursive: true, force: true });
    rmSync(targetDir, { recursive: true, force: true });
  });

  it("should handle conversational fast-path without spawning child worker lanes", async () => {
    const res = await controller.activate({
      provider: "opencode",
      customRoot: testRoot,
      targetDir,
      mission: "Explain what Metis 插件版 does",
    });

    expect(res.success).toBe(true);
    expect(res.route).toBe("fast-path");
    expect(res.gateEvidence).toHaveLength(0);
    expect(res.summary).toContain("Conversational ask addressed directly");
  });

  it("should coordinate T0 mechanical apply changes with G4-only evidence", async () => {
    const res = await controller.activate({
      provider: "opencode",
      customRoot: testRoot,
      targetDir,
      mission: "Rename variable foo to bar everywhere and apply formatting",
    });

    expect(res.success).toBe(true);
    expect(res.route).toBe("T0");
    expect(res.framework).toBe("apply");
    expect(res.gateEvidence.map(g => g.gate)).toEqual(["G4"]);
    expect(res.assignment.phases.map(p => p.role)).toEqual(["root"]);
    expect(res.assignment.phases[0]?.ownedPaths).toEqual(["."]);
    expect(res.gateEvidence[0]?.details?.executed).toBe(true);
    expect(res.gateEvidence[0]?.details?.rootClosed).toBe(true);
    expect(res.gateEvidence[0]?.output).not.toContain("without spawning");
    expect(existsSync(join(targetDir, ".metis-plugin/receipts/G4.md"))).toBe(true);
  });

  it("should coordinate bounded debug with root-closed G0/G1/G3.5 then G5/G6 spawn (no goal-check)", async () => {
    const res = await controller.activate({
      provider: "opencode",
      customRoot: testRoot,
      targetDir,
      mission: "Fix defect in calculation where null input causes TypeError",
    });

    expect(res.success).toBe(true);
    expect(res.route).toBe("debug");
    expect(res.framework).toBe("backend-fix");
    const gates = res.gateEvidence.map(g => g.gate);
    expect(gates).toEqual(["G0", "G1", "G3.5", "G4", "G5", "G6"]);
    expect(res.assignment.phases.find(p => p.gate === "G3.5")?.role).toBe("root");
    expect(res.assignment.phases.find(p => p.gate === "G4")?.role).toBe("root");
    expect(res.assignment.phases.find(p => p.gate === "G5")?.role).toBe("reviewer");
    expect(res.assignment.phases.some(p => p.gate === "goal-check")).toBe(false);
    expect(res.assignment.phases.some(p => p.role === "depth-prober")).toBe(false);
  });

  it("should honor path=direct and concurrency controls", async () => {
    const res = await controller.activate({
      provider: "opencode",
      customRoot: testRoot,
      targetDir,
      mission: "Build a large multi-surface fleet across api, web, and mobile",
      path: "direct",
      concurrency: "custom",
      maxSubs: 3,
      dryRun: true,
    });
    expect(res.route).toBe("T0");
    expect(res.assignment.concurrency).toBe("custom");
    expect(res.assignment.maxSubs).toBe(3);
  });

  function admitSurfaceDirs(root: string, ids: string[]) {
    for (const id of ids) mkdirSync(join(root, id), { recursive: true });
  }

  it("should select T3 with sweeper and root goal-check (no juror or goal-checker spawn)", async () => {
    admitSurfaceDirs(targetDir, ["api", "web", "mobile"]);
    const res = await controller.activate({
      provider: "opencode",
      customRoot: testRoot,
      targetDir,
      mission: "Replace authentication across api, web, and mobile with multi-surface fleet migration",
      dryRun: true,
    });
    expect(res.route).toBe("T3");
    const roles = res.assignment.phases.map(p => p.role);
    expect(res.assignment.phases.find(p => p.gate === "G2")?.role).toBe("root");
    expect(roles).not.toContain("scope-coordinator");
    expect(roles).toContain("sweeper");
    expect(res.assignment.phases.filter(p => p.laneId).map(p => p.laneId)).toEqual(["api", "web", "mobile"]);
    expect(res.assignment.phases.filter(p => p.laneId).map(p => p.ownedPaths)).toEqual([["api"], ["web"], ["mobile"]]);
    expect(res.assignment.phases.find(p => p.gate === "goal-check")?.role).toBe("root");
    expect(roles).not.toContain("goal-checker");
    expect(roles).not.toContain("juror");
    expect(roles).not.toContain("planner");
  });

  it("should not escalate to T3 from comma/and count alone", async () => {
    const res = await controller.activate({
      provider: "opencode",
      customRoot: testRoot,
      targetDir,
      mission: "Add retries and logging and metrics for the parser",
      dryRun: true,
    });
    expect(res.route).toBe("T1");
  });

  it("should run T3 implementer phases in one parallel batch", async () => {
    admitSurfaceDirs(targetDir, ["api", "web", "mobile"]);
    const res = await controller.activate({
      provider: "opencode",
      customRoot: testRoot,
      targetDir,
      mission: "Replace authentication across api, web, and mobile with multi-surface fleet migration",
      concurrency: "custom",
      maxSubs: 4,
    });
    expect(res.success).toBe(true);
    expect(res.route).toBe("T3");
    const implementers = res.assignment.phases.filter(p => p.parallelGroup === "t3-implement");
    expect(implementers.map(p => p.laneId)).toEqual(["api", "web", "mobile"]);
    expect(implementers.every(p => p.parallelGroup === "t3-implement")).toBe(true);
    const g4Evidence = res.gateEvidence.filter(g => g.gate === "G4");
    expect(g4Evidence.length).toBe(implementers.length);
  });

  it("should keep T3 lanes equal to named surfaces when concurrency is wide", async () => {
    admitSurfaceDirs(targetDir, ["api", "web", "mobile"]);
    const res = await controller.activate({
      provider: "opencode",
      customRoot: testRoot,
      targetDir,
      mission: "Replace authentication across api, web, and mobile with multi-surface fleet migration",
      concurrency: "wide",
      dryRun: true,
    });
    expect(res.route).toBe("T3");
    expect(res.assignment.phases.filter(p => p.laneId).map(p => p.laneId)).toEqual(["api", "web", "mobile"]);
  });

  it("should admit exactly the named disjoint surfaces, not a padded lane count", async () => {
    admitSurfaceDirs(targetDir, ["api", "web"]);
    const res = await controller.activate({
      provider: "opencode",
      customRoot: testRoot,
      targetDir,
      mission: "Migrate billing across api and web",
      concurrency: "wide",
      dryRun: true,
    });
    expect(res.route).toBe("T3");
    expect(res.assignment.phases.filter(p => p.laneId).map(p => p.laneId)).toEqual(["api", "web"]);
    expect(res.assignment.phases.filter(p => p.gate === "G4").map(p => p.ownedPaths)).toEqual([["api"], ["web"]]);
    expect(res.assignment.phases.find(p => p.gate === "G2")?.role).toBe("root");
  });

  it("should downgrade a fleet mention without two surfaces to T2 and close G2 as root", async () => {
    const res = await controller.activate({
      provider: "opencode",
      customRoot: testRoot,
      targetDir,
      mission: "Coordinate a multi-surface fleet migration",
      dryRun: true,
    });
    expect(res.route).toBe("T2");
    expect(res.assignment.phases.find(p => p.gate === "G2")?.role).toBe("root");
    expect(res.assignment.phases.map(p => p.role)).not.toContain("scope-coordinator");
    expect(res.assignment.phases.filter(p => p.parallelGroup === "t3-implement")).toHaveLength(0);
  });

  it("should refuse T3 when named surfaces have no workspace directories", async () => {
    const res = await controller.activate({
      provider: "opencode",
      customRoot: testRoot,
      targetDir,
      mission: "Replace authentication across api, web, and mobile with multi-surface fleet migration",
      dryRun: true,
    });
    expect(res.route).toBe("T2");
    const implementers = res.assignment.phases.filter(p => p.gate === "G4");
    expect(implementers).toHaveLength(1);
    expect(implementers[0]?.ownedPaths).toEqual(["."]);
    expect(implementers[0]?.laneId).toBeUndefined();
  });

  it("should downgrade overlapping owned paths from T3 to serial T2", async () => {
    mkdirSync(join(targetDir, "api", "web"), { recursive: true });
    const res = await controller.activate({
      provider: "opencode",
      customRoot: testRoot,
      targetDir,
      mission: "Replace authentication across api and web with a multi-surface fleet migration",
      dryRun: true,
    });
    expect(res.route).toBe("T2");
    const implementers = res.assignment.phases.filter(p => p.gate === "G4");
    expect(implementers.map(p => p.ownedPaths)).toEqual([["api"], ["api/web"]]);
    expect(implementers.every(p => p.parallelGroup === undefined)).toBe(true);
  });

  it("should run shared-state surfaces as serial T2 lanes", async () => {
    admitSurfaceDirs(targetDir, ["api", "web"]);
    const res = await controller.activate({
      provider: "opencode",
      customRoot: testRoot,
      targetDir,
      mission: "Migrate billing across api and web with a shared database",
      dryRun: true,
    });
    expect(res.route).toBe("T2");
    const implementers = res.assignment.phases.filter(p => p.gate === "G4");
    expect(implementers.map(p => p.laneId)).toEqual(["api", "web"]);
    expect(implementers.map(p => p.ownedPaths)).toEqual([["api"], ["web"]]);
    expect(implementers.every(p => p.parallelGroup === undefined)).toBe(true);
    expect(res.assignment.phases.find(p => p.gate === "goal-check")?.role).toBe("goal-checker");
    expect(res.assignment.phases.map(p => p.role)).not.toContain("scope-coordinator");
  });

  it("keeps a single-surface architecture/design task on T1", async () => {
    const res = await controller.activate({
      provider: "opencode",
      customRoot: testRoot,
      targetDir,
      mission: "Design the architecture for this parser",
      dryRun: true,
    });
    expect(res.route).toBe("T1");
    expect(res.assignment.phases.filter(p => p.gate === "G4")).toHaveLength(1);
    expect(res.assignment.phases.some(p => p.role === "juror")).toBe(false);
  });

  it("should root-close T3 debug gates that the spawn allowlist rejects", async () => {
    admitSurfaceDirs(targetDir, ["api", "web", "mobile"]);
    const res = await controller.activate({
      provider: "opencode",
      customRoot: testRoot,
      targetDir,
      mission: "Fix authentication across api, web, and mobile",
      dryRun: true,
    });
    expect(res.route).toBe("debug");
    expect(res.framework).toBe("backend-fix");
    for (const gate of ["G0", "G1", "G3.5", "G2"]) {
      expect(res.assignment.phases.find(p => p.gate === gate)?.role).toBe("root");
    }
    expect(res.assignment.phases.filter(p => p.laneId).map(p => p.laneId)).toEqual(["api", "web", "mobile"]);
    expect(res.assignment.phases.map(p => p.role)).not.toContain("planner");
    expect(res.assignment.phases.map(p => p.role)).not.toContain("depth-prober");
    expect(res.assignment.phases.map(p => p.role)).not.toContain("juror");
  });

  it("should classify web animation, UI, or canvas requests to frontend-build framework", async () => {
    const res = await controller.activate({
      provider: "opencode",
      customRoot: testRoot,
      targetDir,
      mission: "创建一个鹈鹕骑自行车动画",
    });

    expect(res.success).toBe(true);
    expect(res.route).toBe("T1");
    expect(res.framework).toBe("frontend-build");
    expect(res.assignment.phases[0].taskBrief).toContain("standalone runnable web code");
  });

  it("should support dry-run validation without mutating target", async () => {
    const res = await controller.activate({
      provider: "opencode",
      customRoot: testRoot,
      targetDir,
      mission: "Build user profile update endpoint",
      dryRun: true,
    });

    expect(res.success).toBe(true);
    expect(res.route).toBe("T1");
    expect(res.summary).toContain("[DRY-RUN]");
  });

  it("should reject out-of-scope providers with PROVIDER_UNSUPPORTED", async () => {
    await expect(controller.activate({
      provider: "cursor",
      customRoot: testRoot,
      targetDir,
      mission: "Build feature",
    })).rejects.toThrow(/PROVIDER_UNSUPPORTED/);

    await expect(controller.activate({
      provider: "claude",
      customRoot: testRoot,
      targetDir,
      mission: "Build feature",
    })).rejects.toThrow(/PROVIDER_UNSUPPORTED/);

    await expect(controller.activate({
      provider: "vscode",
      customRoot: testRoot,
      targetDir,
      mission: "Build feature",
    })).rejects.toThrow(/PROVIDER_UNSUPPORTED/);
  });

  it("should resolve model pre-launch without affecting route selection", async () => {
    // 1. Explicit model request
    const resExplicit = await controller.activate({
      provider: "opencode",
      customRoot: testRoot,
      targetDir,
      mission: "Fix calculation bug in payroll",
      model: "custom-claude-3-7-sonnet",
      thinking: true,
    });
    expect(resExplicit.resolvedModel.model).toBe("custom-claude-3-7-sonnet");
    expect(resExplicit.resolvedModel.thinking).toBe(true);
    expect(resExplicit.resolvedModel.source).toBe("explicit");
    // Route selected by mission text alone (debug route), NOT by model
    expect(resExplicit.route).toBe("debug");

    // 2. Default baseline per provider
    const resDefault = await controller.activate({
      provider: "opencode",
      customRoot: testRoot,
      targetDir,
      mission: "Apply rename of variable",
    });
    expect(resDefault.resolvedModel.model).toBe("claude-3-5-sonnet");
    expect(resDefault.resolvedModel.source).toBe("provider-default");
    expect(resDefault.route).toBe("T0");
  });

  it("should execute via CLI bin script with doctor and envelope commands", () => {
    const binPath = resolve(process.cwd(), "bin/metis-plugin.js");
    expect(existsSync(binPath)).toBe(true);

    const out = execSync(`node "${binPath}" doctor opencode --root "${testRoot}" --json`, {
      encoding: "utf-8",
    });

    const parsed = JSON.parse(out);
    expect(parsed.status).toBe("ok");
    expect(parsed.results[0].verified).toBe(true);

    // Test general doctor across all hosts when at least one is installed
    const multiOut = execSync(`node "${binPath}" doctor --root "${testRoot}" --json`, {
      encoding: "utf-8",
    });
    const parsedMulti = JSON.parse(multiOut);
    expect(parsedMulti.status).toBe("ok");
    expect(parsedMulti.results.some((r: any) => r.provider === "opencode" && r.verified)).toBe(true);

    // Test $metis envelope execution via CLI
    const codexRoot = join(testRoot, "codex-subroot");
    execSync(`node "${binPath}" install codex --root "${codexRoot}"`, { encoding: "utf-8" });
    const envelopeOut = execSync(`node "${binPath}" "$metis activate target=${targetDir} dryRun=true mission=\\"Fix auth defect\\"" --root "${codexRoot}" --json`, {
      encoding: "utf-8",
    });
    const parsedEnvelope = JSON.parse(envelopeOut);
    expect(parsedEnvelope.success).toBe(true);
    expect(parsedEnvelope.provider).toBe("codex");
    expect(parsedEnvelope.route).toBe("debug");
  });

  it("should call user's currently used model across all three platforms without falling back to hardcoded baselines", async () => {
    // 1. OpenCode: user uses deepseek-ai/deepseek-v3
    writeFileSync(join(testRoot, "opencode.json"), JSON.stringify({ model: "deepseek-ai/deepseek-v3" }), "utf-8");
    const ocRes = await controller.activate({
      provider: "opencode",
      customRoot: testRoot,
      targetDir,
      mission: "Build user profile update endpoint",
    });
    expect(ocRes.resolvedModel.model).toBe("deepseek-ai/deepseek-v3");
    expect(ocRes.resolvedModel.source).toBe("host-config");

    // 2. Codex: user uses o3-mini via config.toml
    const codexRoot = join(testRoot, "codex-test");
    mkdirSync(codexRoot, { recursive: true });
    const { CodexAdapter } = await import("../packages/metis-plugin/src/adapters/codex.ts");
    const codexAdapter = new CodexAdapter();
    await codexAdapter.install(codexRoot);
    writeFileSync(join(codexRoot, "config.toml"), `model = "o3-mini"\n`, "utf-8");

    const codexRes = await controller.activate({
      provider: "codex",
      customRoot: codexRoot,
      targetDir,
      mission: "Build user profile update endpoint",
    });
    expect(codexRes.resolvedModel.model).toBe("o3-mini");
    expect(codexRes.resolvedModel.source).toBe("host-config");

    // 3. DeepSeek Harness: user uses deepseek-reasoner via config.json
    const dshRoot = join(testRoot, "dsh-test");
    mkdirSync(dshRoot, { recursive: true });
    const { DeepSeekAdapter } = await import("../packages/metis-plugin/src/adapters/deepseek.ts");
    const dshAdapter = new DeepSeekAdapter();
    await dshAdapter.install(dshRoot);
    writeFileSync(join(dshRoot, "config.json"), JSON.stringify({ model: "deepseek-reasoner" }), "utf-8");

    const dshRes = await controller.activate({
      provider: "deepseek",
      customRoot: dshRoot,
      targetDir,
      mission: "Build user profile update endpoint",
    });
    expect(dshRes.resolvedModel.model).toBe("deepseek-reasoner");
    expect(dshRes.resolvedModel.thinking).toBe(true);
    expect(dshRes.resolvedModel.source).toBe("host-config");

    // Verify all 3 had route "T1" chosen purely by mission, unaffected by model
    expect(ocRes.route).toBe("T1");
    expect(codexRes.route).toBe("T1");
    expect(dshRes.route).toBe("T1");

    // Verify all 3 recorded the active model in every gate execution evidence
    for (const g of ocRes.gateEvidence) {
      expect(g.details?.model).toBe("deepseek-ai/deepseek-v3");
    }
    for (const g of codexRes.gateEvidence) {
      expect(g.details?.model).toBe("o3-mini");
    }
    for (const g of dshRes.gateEvidence) {
      expect(g.details?.model).toBe("deepseek-reasoner");
      expect(g.details?.thinking).toBe(true);
    }
  });

  it("should prioritize explicit inherit over global METIS_MODEL environment variable", async () => {
    writeFileSync(join(testRoot, "opencode.json"), JSON.stringify({ model: "host-configured-model" }), "utf-8");
    const originalMetisModel = process.env.METIS_MODEL;
    process.env.METIS_MODEL = "global-metis-override";

    try {
      const res = await controller.activate({
        provider: "opencode",
        customRoot: testRoot,
        targetDir,
        mission: "Build profile",
        model: "inherit",
      });

      // User explicitly asked to inherit: must inherit from host, NOT use global METIS_MODEL override
      expect(res.resolvedModel.model).toBe("host-configured-model");
      expect(res.resolvedModel.source).toBe("inherited");
    } finally {
      if (originalMetisModel !== undefined) {
        process.env.METIS_MODEL = originalMetisModel;
      } else {
        delete process.env.METIS_MODEL;
      }
    }
  });
});

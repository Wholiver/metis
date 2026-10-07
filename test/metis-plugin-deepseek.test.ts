import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DeepSeekAdapter } from "../packages/metis-plugin/src/adapters/deepseek.ts";
import { ExternalController } from "../packages/metis-plugin/src/controller.ts";
import { CordisBridge } from "../packages/metis-plugin/src/cordis-bridge/index.ts";

describe("Metis 插件版 - P3 DeepSeek Harness & Cordis Bridge", () => {
  let testRoot: string;
  let targetDir: string;
  let adapter: DeepSeekAdapter;
  let controller: ExternalController;

  beforeEach(() => {
    testRoot = join(tmpdir(), `metis-test-dsh-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    targetDir = join(tmpdir(), `metis-test-target-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(testRoot, { recursive: true });
    mkdirSync(targetDir, { recursive: true });
    adapter = new DeepSeekAdapter();
    controller = new ExternalController();
  });

  afterEach(() => {
    rmSync(testRoot, { recursive: true, force: true });
    rmSync(targetDir, { recursive: true, force: true });
  });

  it("should install DeepSeek adapter with skill shim, compat presets, and owned Cordis bridge", async () => {
    const receipt = await adapter.install(testRoot);

    expect(receipt.provider).toBe("deepseek");
    expect(receipt.installRoot).toBe(testRoot);
    expect(receipt.launcherPath).toBe("skills/metis/SKILL.md");
    expect(receipt.files.length).toBeGreaterThanOrEqual(14);

    // Check receipt file written to disk
    const receiptPath = join(testRoot, ".metis-plugin-deepseek.json");
    expect(existsSync(receiptPath)).toBe(true);

    // Check compatibility presets
    const presetPath = join(testRoot, "agent-preset", "metis-coordinator.json");
    expect(existsSync(presetPath)).toBe(true);
    const preset = JSON.parse(readFileSync(presetPath, "utf-8"));
    expect(preset.compatibilityOnly).toBe(true);

    // Check owned Cordis bridge installed
    const bridgePath = join(testRoot, "cordis-bridge", "index.js");
    expect(existsSync(bridgePath)).toBe(true);

    // Check launcher skill exists and contains Request Primacy
    const launcherPath = join(testRoot, "skills", "metis", "SKILL.md");
    expect(existsSync(launcherPath)).toBe(true);
    const launcherText = readFileSync(launcherPath, "utf-8");
    expect(launcherText).toContain("Request Primacy");
    expect(launcherText).toContain("metis-plugin activate deepseek");
    expect(launcherText).toContain("There is no default route");
    expect(launcherText).toContain("Loading a skill never creates or resumes a run");
    expect(launcherText).toContain("metis-reviewer");
    expect(launcherText).toContain("Strict Language Consistency");
    expect(launcherText).toContain("Active Intermediate Text");

    // Check In-Session Playbooks, Gates, Modes, and Frameworks exist
    expect(existsSync(join(testRoot, "skills", "metis", "PLAYBOOKS.md"))).toBe(true);
    expect(existsSync(join(testRoot, "skills", "metis", "GATES.md"))).toBe(true);
    expect(existsSync(join(testRoot, "skills", "metis", "MODES.md"))).toBe(true);
    expect(existsSync(join(testRoot, "skills", "metis", "frameworks", "frontend-build.md"))).toBe(true);
    expect(existsSync(join(testRoot, "skills", "metis", "frameworks", "backend-fix.md"))).toBe(true);
    const playbooksText = readFileSync(join(testRoot, "skills", "metis", "PLAYBOOKS.md"), "utf-8");
    expect(playbooksText).toContain("frontend-build");
    expect(playbooksText).toContain("Deliverable Contracts");
  });

  it("should verify owned Cordis SDK bridge provides controller-owned tools", () => {
    const bridge = new CordisBridge({ workspaceRoot: targetDir });
    const health = bridge.healthCheck();

    expect(health.ok).toBe(true);
    expect(health.tools).toContain("read");
    expect(health.tools).toContain("write");
    expect(health.tools).toContain("edit");
    expect(health.tools).toContain("bash");
    expect(health.tools).toContain("grep");
    expect(health.tools).toContain("find");
    expect(health.tools).toContain("ls");

    // Test tool execution via bridge
    const writeRes = bridge.invokeTool("write", { path: "test.txt", content: "Hello Cordis" });
    expect(writeRes.success).toBe(true);

    const readRes = bridge.invokeTool("read", { path: "test.txt" });
    expect(readRes.success).toBe(true);
    expect(readRes.output).toBe("Hello Cordis");
  });

  it("should pass doctor check on fresh install with operational Cordis bridge", async () => {
    await adapter.install(testRoot);
    const doc = await adapter.doctor(testRoot);

    expect(doc.provider).toBe("deepseek");
    expect(doc.detected).toBe(true);
    expect(doc.installed).toBe(true);
    expect(doc.bundleHashValid).toBe(true);
    expect(doc.verified).toBe(true);
    expect(doc.details.cordisBridgeValid).toBe(true);
    expect(doc.details.productionPath).toBe("owned-cordis-bridge");
    expect(doc.errors).toHaveLength(0);
  });

  it("should fail closed in doctor check if Cordis SDK bridge is missing", async () => {
    await adapter.install(testRoot);

    // Remove the mandatory Cordis bridge
    const bridgeFile = join(testRoot, "cordis-bridge", "index.js");
    rmSync(bridgeFile);

    const doc = await adapter.doctor(testRoot);
    expect(doc.verified).toBe(false);
    expect(doc.errors.some(e => e.includes("FAIL_CLOSED"))).toBe(true);
    expect(doc.errors.some(e => e.includes("Mandatory owned Cordis SDK bridge missing"))).toBe(true);
  });

  it("should refuse activation if Cordis SDK bridge is missing (fail-closed)", async () => {
    await adapter.install(testRoot);

    // Remove bridge
    rmSync(join(testRoot, "cordis-bridge", "index.js"));

    await expect(controller.activate({
      provider: "deepseek",
      customRoot: testRoot,
      targetDir,
      mission: "Build search API",
    })).rejects.toThrow(/ACTIVATION_FAILED/);
  });

  it("should fail closed in doctor check if Cordis SDK bridge is incomplete or corrupted", async () => {
    await adapter.install(testRoot);

    // Corrupt the bridge file to missing tools
    const bridgeFile = join(testRoot, "cordis-bridge", "index.js");
    writeFileSync(bridgeFile, "export const CORDIS_BRIDGE_VERSION = '1.0.0';", "utf-8");

    const doc = await adapter.doctor(testRoot);
    expect(doc.verified).toBe(false);
    expect(doc.errors.some(e => e.includes("FAIL_CLOSED"))).toBe(true);
  });

  it("should activate using Cordis bridge and verify real tool invocations on valid installation", async () => {
    await adapter.install(testRoot);

    const result = await controller.activate({
      provider: "deepseek",
      customRoot: testRoot,
      targetDir,
      mission: "Build async job processor queue",
    });

    expect(result.success).toBe(true);
    expect(result.provider).toBe("deepseek");
    expect(result.route).toBe("T1");
    expect(result.gateEvidence.length).toBe(3);
    expect(result.gateEvidence.map(g => g.role)).toEqual(["root", "reviewer", "verifier"]);
    expect(result.gateEvidence.map(g => g.status)).toEqual(["PASS", "PASS", "VERIFIED"]);
    expect(result.gateEvidence[0]!.details?.rootClosed).toBe(true);

    // Spawned gates must use Cordis bridge tools (root-closed G4 does not)
    for (const gate of result.gateEvidence.filter((g) => g.role !== "root")) {
      expect(gate.details?.cordisBridgeUsed).toBe(true);
      expect(gate.details?.bridgeToolCalls).toBeDefined();
      expect(gate.details?.bridgeToolCalls.length).toBeGreaterThan(0);
      for (const call of gate.details?.bridgeToolCalls) {
        expect(call.success).toBe(true);
      }
    }
  });

  it("should support OwnedTools writing to subdirectories and safe glob finding", () => {
    const bridge = new CordisBridge({ workspaceRoot: targetDir });

    // Test writing to nested subdirectory
    const writeRes = bridge.invokeTool("write", { path: "nested/sub/dir/test.ts", content: "export const x = 1;" });
    expect(writeRes.success).toBe(true);

    // Test read back
    const readRes = bridge.invokeTool("read", { path: "nested/sub/dir/test.ts" });
    expect(readRes.success).toBe(true);
    expect(readRes.output).toBe("export const x = 1;");

    // Test finding with glob and regex special characters
    const findRes = bridge.invokeTool("find", { pattern: "*.ts" });
    expect(findRes.success).toBe(true);
    expect(findRes.output).toContain("test.ts");

    // Test pattern with regex special characters that shouldn't crash
    const regexFindRes = bridge.invokeTool("find", { pattern: "test[0-9].ts" });
    expect(regexFindRes.success).toBe(true);
  });

  it("should cleanly uninstall all installed files and receipt", async () => {
    await adapter.install(testRoot);
    const uninstalled = await adapter.uninstall(testRoot);

    expect(uninstalled.success).toBe(true);
    expect(uninstalled.removedFiles.length).toBeGreaterThan(0);
    expect(existsSync(join(testRoot, ".metis-plugin-deepseek.json"))).toBe(false);

    const doc = await adapter.doctor(testRoot);
    expect(doc.installed).toBe(false);
    expect(doc.verified).toBe(false);
  });

  it("should detect and inherit user configured model from config.json in host root and enable thinking for reasoning models", async () => {
    await adapter.install(testRoot);

    // User configured DeepSeek Harness with deepseek-reasoner
    writeFileSync(join(testRoot, "config.json"), JSON.stringify({
      model: "deepseek-reasoner",
    }), "utf-8");

    const doc = await adapter.doctor(testRoot);
    expect(doc.details.activeModel).toBe("deepseek-reasoner");
    expect(doc.details.activeModelSource).toBe("host-config");

    const result = await controller.activate({
      provider: "deepseek",
      customRoot: testRoot,
      targetDir,
      mission: "Build vector embeddings index",
    });

    expect(result.success).toBe(true);
    expect(result.resolvedModel.model).toBe("deepseek-reasoner");
    // Reasoning model automatically has thinking enabled
    expect(result.resolvedModel.thinking).toBe(true);
    expect(result.resolvedModel.source).toBe("host-config");
  });

  it("should prioritize workspace project .dsh/config.json over host-level config", async () => {
    await adapter.install(testRoot);

    // Host level has deepseek-chat
    writeFileSync(join(testRoot, "config.json"), JSON.stringify({ model: "deepseek-chat" }), "utf-8");

    // Workspace project has deepseek-v4-preview
    mkdirSync(join(targetDir, ".dsh"), { recursive: true });
    writeFileSync(join(targetDir, ".dsh", "config.json"), JSON.stringify({
      model: "deepseek-v4-preview",
      thinking: true,
    }), "utf-8");

    const result = await controller.activate({
      provider: "deepseek",
      customRoot: testRoot,
      targetDir,
      mission: "Implement async queue",
    });

    expect(result.resolvedModel.model).toBe("deepseek-v4-preview");
    expect(result.resolvedModel.thinking).toBe(true);
    expect(result.resolvedModel.source).toBe("host-config");
  });

  it("should inherit model from DSH_MODEL environment variable and auto-enable thinking for R1", async () => {
    await adapter.install(testRoot);
    const originalEnv = process.env.DSH_MODEL;
    process.env.DSH_MODEL = "deepseek-r1";

    try {
      const result = await controller.activate({
        provider: "deepseek",
        customRoot: testRoot,
        targetDir,
        mission: "Refactor pipeline execution",
      });

      expect(result.resolvedModel.model).toBe("deepseek-r1");
      expect(result.resolvedModel.thinking).toBe(true);
      expect(result.resolvedModel.source).toBe("env");
    } finally {
      if (originalEnv !== undefined) {
        process.env.DSH_MODEL = originalEnv;
      } else {
        delete process.env.DSH_MODEL;
      }
    }
  });

  it("should handle native inherit resolution for DeepSeek", async () => {
    await adapter.install(testRoot);

    writeFileSync(join(testRoot, "config.json"), JSON.stringify({
      model: "inherit",
    }), "utf-8");

    const result = await controller.activate({
      provider: "deepseek",
      customRoot: testRoot,
      targetDir,
      mission: "Explain distributed consensus",
    });

    expect(result.resolvedModel.model).toBe("inherit");
    expect(result.resolvedModel.source).toBe("inherited");
  });

  it("should parse DeepSeek TOML config file with inline comment and detect reasoning model", async () => {
    await adapter.install(testRoot);

    writeFileSync(join(testRoot, "deepseek.toml"), `model = "deepseek-r1" # production flagship\n`, "utf-8");

    const doc = await adapter.doctor(testRoot);
    expect(doc.details.activeModel).toBe("deepseek-r1");

    const result = await controller.activate({
      provider: "deepseek",
      customRoot: testRoot,
      targetDir,
      mission: "Build tokenizer benchmark",
    });

    expect(result.resolvedModel.model).toBe("deepseek-r1");
    expect(result.resolvedModel.thinking).toBe(true);
    expect(result.resolvedModel.source).toBe("host-config");
  });

  it("should detect DeepSeek model from dotted key in config.json", async () => {
    await adapter.install(testRoot);

    writeFileSync(join(testRoot, "config.json"), JSON.stringify({
      "deepseek.model": "deepseek-ai/deepseek-v3",
    }), "utf-8");

    const result = await controller.activate({
      provider: "deepseek",
      customRoot: testRoot,
      targetDir,
      mission: "Deploy inference worker",
    });

    expect(result.resolvedModel.model).toBe("deepseek-ai/deepseek-v3");
    expect(result.resolvedModel.source).toBe("host-config");
  });

  it("should inherit model and auto-enable thinking from sessionSettings", async () => {
    await adapter.install(testRoot);

    const result = await controller.activate({
      provider: "deepseek",
      customRoot: testRoot,
      targetDir,
      mission: "Solve math benchmark",
      sessionSettings: {
        model: "deepseek-reasoner",
      },
    });

    expect(result.resolvedModel.model).toBe("deepseek-reasoner");
    expect(result.resolvedModel.thinking).toBe(true);
    expect(result.resolvedModel.source).toBe("session");
  });
});

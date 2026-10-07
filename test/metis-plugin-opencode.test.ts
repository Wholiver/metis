import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { OpenCodeAdapter } from "../packages/metis-plugin/src/adapters/opencode.ts";
import { ExternalController } from "../packages/metis-plugin/src/controller.ts";
import { parseYamlFrontmatter } from "../packages/metis-plugin/src/utils.ts";

describe("Metis 插件版 - P1 OpenCode Adapter & Lifecycle CLI", () => {
  let testRoot: string;
  let targetDir: string;
  let adapter: OpenCodeAdapter;
  let controller: ExternalController;

  beforeEach(() => {
    testRoot = join(tmpdir(), `metis-test-opencode-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    targetDir = join(tmpdir(), `metis-test-target-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(testRoot, { recursive: true });
    mkdirSync(targetDir, { recursive: true });
    adapter = new OpenCodeAdapter();
    controller = new ExternalController();
  });

  afterEach(() => {
    rmSync(testRoot, { recursive: true, force: true });
    rmSync(targetDir, { recursive: true, force: true });
  });

  it("should install OpenCode adapter with launcher, roles, bundle and receipt", async () => {
    const receipt = await adapter.install(testRoot);

    expect(receipt.provider).toBe("opencode");
    expect(receipt.installRoot).toBe(testRoot);
    expect(receipt.launcherPath).toBe("commands/metis.md");
    expect(receipt.files.length).toBeGreaterThanOrEqual(8);
    expect(receipt.roles).toHaveLength(26);
    expect(receipt.roles).toContain("coordinator");
    expect(receipt.roles).toContain("planner");
    expect(receipt.roles).toContain("implementer");
    expect(receipt.roles).toContain("reviewer");
    expect(receipt.roles).toContain("verifier");

    // Check receipt file written to disk
    const receiptPath = join(testRoot, ".metis-plugin-opencode.json");
    expect(existsSync(receiptPath)).toBe(true);

    // Check launcher command exists
    const launcherPath = join(testRoot, "commands", "metis.md");
    expect(existsSync(launcherPath)).toBe(true);
    const launcherText = readFileSync(launcherPath, "utf-8");
    expect(launcherText).toContain("metis-plugin activate opencode");
    expect(launcherText).toContain("There is no default route");
    expect(launcherText).toContain("Loading a skill never creates or resumes a run");
    expect(launcherText).toContain("Request Primacy");
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

  it("should enforce mode: subagent and deny task/skill permissions in all OpenCode roles", async () => {
    await adapter.install(testRoot);

    const roles = ["coordinator", "planner", "implementer", "reviewer", "verifier"];
    for (const r of roles) {
      const roleFile = join(testRoot, "agents", `metis-${r}.md`);
      expect(existsSync(roleFile), `Role file for ${r} must exist`).toBe(true);

      const content = readFileSync(roleFile, "utf-8");
      const parsed = parseYamlFrontmatter<any>(content);

      expect(parsed.data.mode).toBe("subagent");
      expect(parsed.data.permission).toBeDefined();
      expect(parsed.data.permission.task).toBe("deny");
      expect(parsed.data.permission.skill).toBe("deny");
      expect(parsed.data.permission.read).toBe("allow");
    }
  });

  it("should pass doctor check on fresh install", async () => {
    await adapter.install(testRoot);
    const doc = await adapter.doctor(testRoot);

    expect(doc.provider).toBe("opencode");
    expect(doc.detected).toBe(true);
    expect(doc.installed).toBe(true);
    expect(doc.bundleHashValid).toBe(true);
    expect(doc.verified).toBe(true);
    expect(doc.errors).toHaveLength(0);
    expect(doc.details.nativeDispatchAllowed).toBe(false);
  });

  it("should fail doctor check when an installed file is tampered with", async () => {
    await adapter.install(testRoot);

    // Tamper with a role file
    const roleFile = join(testRoot, "agents", "metis-implementer.md");
    writeFileSync(roleFile, "TAMPERED CONTENT", "utf-8");

    const doc = await adapter.doctor(testRoot);
    expect(doc.verified).toBe(false);
    expect(doc.errors.some(e => e.includes("Hash mismatch"))).toBe(true);
  });

  it("should execute mission via external controller on valid install and target", async () => {
    await adapter.install(testRoot);

    const result = await controller.activate({
      provider: "opencode",
      customRoot: testRoot,
      targetDir,
      mission: "Build customer notifications webhook handler",
    });

    expect(result.success).toBe(true);
    expect(result.provider).toBe("opencode");
    expect(result.route).toBe("T1");
    expect(result.gateEvidence.length).toBe(3); // G4, G5, G6
    expect(result.gateEvidence.map(g => g.status)).toEqual(["PASS", "PASS", "VERIFIED"]);
  });

  it("should refuse activation if target directory does not exist", async () => {
    await adapter.install(testRoot);
    const nonExistentTarget = join(testRoot, "non-existent-folder");

    await expect(controller.activate({
      provider: "opencode",
      customRoot: testRoot,
      targetDir: nonExistentTarget,
      mission: "Some mission",
    })).rejects.toThrow(/TARGET_NOT_FOUND/);
  });

  it("should cleanly uninstall all installed files and receipt", async () => {
    await adapter.install(testRoot);
    const uninstalled = await adapter.uninstall(testRoot);

    expect(uninstalled.success).toBe(true);
    expect(uninstalled.removedFiles.length).toBeGreaterThan(0);
    expect(existsSync(join(testRoot, ".metis-plugin-opencode.json"))).toBe(false);
    expect(existsSync(join(testRoot, "commands", "metis.md"))).toBe(false);

    const doc = await adapter.doctor(testRoot);
    expect(doc.installed).toBe(false);
    expect(doc.verified).toBe(false);
  });

  it("should detect and inherit user configured model from opencode.json in host root", async () => {
    await adapter.install(testRoot);

    // User configured OpenCode with a specific model in host root
    writeFileSync(join(testRoot, "opencode.json"), JSON.stringify({
      model: "deepseek-ai/deepseek-v3",
    }), "utf-8");

    const doc = await adapter.doctor(testRoot);
    expect(doc.details.activeModel).toBe("deepseek-ai/deepseek-v3");
    expect(doc.details.activeModelSource).toBe("host-config");

    const result = await controller.activate({
      provider: "opencode",
      customRoot: testRoot,
      targetDir,
      mission: "Build notification system",
    });

    expect(result.success).toBe(true);
    expect(result.resolvedModel.model).toBe("deepseek-ai/deepseek-v3");
    expect(result.resolvedModel.source).toBe("host-config");
  });

  it("should prioritize workspace project .opencode/opencode.json over host-level config", async () => {
    await adapter.install(testRoot);

    // Host level has one model
    writeFileSync(join(testRoot, "opencode.json"), JSON.stringify({ model: "host-model" }), "utf-8");

    // Workspace project has a different model
    mkdirSync(join(targetDir, ".opencode"), { recursive: true });
    writeFileSync(join(targetDir, ".opencode", "opencode.json"), JSON.stringify({
      model: "workspace-project-model",
      thinking: true,
    }), "utf-8");

    const result = await controller.activate({
      provider: "opencode",
      customRoot: testRoot,
      targetDir,
      mission: "Implement billing logic",
    });

    expect(result.resolvedModel.model).toBe("workspace-project-model");
    expect(result.resolvedModel.thinking).toBe(true);
    expect(result.resolvedModel.source).toBe("host-config");
  });

  it("should inherit model from OPENCODE_MODEL environment variable", async () => {
    await adapter.install(testRoot);
    const originalEnv = process.env.OPENCODE_MODEL;
    process.env.OPENCODE_MODEL = "claude-3-7-sonnet";

    try {
      const result = await controller.activate({
        provider: "opencode",
        customRoot: testRoot,
        targetDir,
        mission: "Refactor auth middleware",
      });

      expect(result.resolvedModel.model).toBe("claude-3-7-sonnet");
      expect(result.resolvedModel.source).toBe("env");
    } finally {
      if (originalEnv !== undefined) {
        process.env.OPENCODE_MODEL = originalEnv;
      } else {
        delete process.env.OPENCODE_MODEL;
      }
    }
  });

  it("should handle native inherit resolution for OpenCode", async () => {
    await adapter.install(testRoot);

    // Config specifies native inherit
    writeFileSync(join(testRoot, "opencode.json"), JSON.stringify({
      model: "inherit",
    }), "utf-8");

    const result = await controller.activate({
      provider: "opencode",
      customRoot: testRoot,
      targetDir,
      mission: "Explain caching architecture",
    });

    expect(result.resolvedModel.model).toBe("inherit");
    expect(result.resolvedModel.source).toBe("inherited");
  });

  it("should parse OpenCode TOML config with inline comments and dotted keys", async () => {
    await adapter.install(testRoot);

    writeFileSync(join(testRoot, "opencode.toml"), `chat.model = "openrouter/anthropic/claude-3.7-sonnet" # trailing comment\nthinking = true # reasoning enabled\n`, "utf-8");

    const doc = await adapter.doctor(testRoot);
    expect(doc.details.activeModel).toBe("openrouter/anthropic/claude-3.7-sonnet");

    const result = await controller.activate({
      provider: "opencode",
      customRoot: testRoot,
      targetDir,
      mission: "Build auth middleware",
    });

    expect(result.resolvedModel.model).toBe("openrouter/anthropic/claude-3.7-sonnet");
    expect(result.resolvedModel.thinking).toBe(true);
    expect(result.resolvedModel.source).toBe("host-config");
  });

  it("should detect model from workspace .vscode/settings.json dotted key", async () => {
    await adapter.install(testRoot);

    mkdirSync(join(targetDir, ".vscode"), { recursive: true });
    writeFileSync(join(targetDir, ".vscode", "settings.json"), JSON.stringify({
      "opencode.model": "deepseek-ai/deepseek-v3",
    }), "utf-8");

    const result = await controller.activate({
      provider: "opencode",
      customRoot: testRoot,
      targetDir,
      mission: "Implement data pipeline",
    });

    expect(result.resolvedModel.model).toBe("deepseek-ai/deepseek-v3");
    expect(result.resolvedModel.source).toBe("host-config");
  });

  it("should detect model from sessionSettings nested object", async () => {
    await adapter.install(testRoot);

    const result = await controller.activate({
      provider: "opencode",
      customRoot: testRoot,
      targetDir,
      mission: "Analyze logs",
      sessionSettings: {
        chat: { model: "claude-3-7-sonnet", thinking: true },
      },
    });

    expect(result.resolvedModel.model).toBe("claude-3-7-sonnet");
    expect(result.resolvedModel.thinking).toBe(true);
    expect(result.resolvedModel.source).toBe("session");
  });
});

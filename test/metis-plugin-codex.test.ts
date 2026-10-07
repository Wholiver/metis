import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { CodexAdapter, parseCodexEnvelope } from "../packages/metis-plugin/src/adapters/codex.ts";
import { ExternalController } from "../packages/metis-plugin/src/controller.ts";

describe("Metis 插件版 - P2 Codex Adapter & Sandboxing", () => {
  let testRoot: string;
  let targetDir: string;
  let adapter: CodexAdapter;
  let controller: ExternalController;

  beforeEach(() => {
    testRoot = join(tmpdir(), `metis-test-codex-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    targetDir = join(tmpdir(), `metis-test-target-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(testRoot, { recursive: true });
    mkdirSync(targetDir, { recursive: true });
    adapter = new CodexAdapter();
    controller = new ExternalController();
  });

  afterEach(() => {
    rmSync(testRoot, { recursive: true, force: true });
    rmSync(targetDir, { recursive: true, force: true });
  });

  it("should install Codex adapter with explicit-only skill shim, TOML roles, and receipt", async () => {
    const receipt = await adapter.install(testRoot);

    expect(receipt.provider).toBe("codex");
    expect(receipt.installRoot).toBe(testRoot);
    expect(receipt.launcherPath).toBe("skills/metis/SKILL.md");
    expect(receipt.files.length).toBeGreaterThanOrEqual(9);

    // Check receipt file written to disk
    const receiptPath = join(testRoot, ".metis-plugin-codex.json");
    expect(existsSync(receiptPath)).toBe(true);

    // Check launcher skill exists and is explicit-only shim
    const launcherPath = join(testRoot, "skills", "metis", "SKILL.md");
    expect(existsSync(launcherPath)).toBe(true);
    const launcherText = readFileSync(launcherPath, "utf-8");
    expect(launcherText).toContain("$metis");
    expect(launcherText).toContain("activation: explicit-only");
    expect(launcherText).toContain("There is no default route");
    expect(launcherText).toContain("metis-reviewer");
    expect(launcherText).toContain("Request Primacy");
    expect(launcherText).toContain("in-session orchestrator");
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

  it("should enforce worker: workspace-write and checker: read-only in TOML roles", async () => {
    await adapter.install(testRoot);

    // Worker role: implementer -> workspace-write
    const implFile = join(testRoot, "agents", "metis-implementer.toml");
    expect(existsSync(implFile)).toBe(true);
    const implContent = readFileSync(implFile, "utf-8");
    expect(implContent).toMatch(/sandbox_mode\s*=\s*"workspace-write"/);
    expect(implContent).toMatch(/name\s*=\s*"metis_implementer"/);

    // Checker and orchestrator roles: read-only
    const readOnlyRoles = ["coordinator", "planner", "reviewer", "verifier"];
    for (const r of readOnlyRoles) {
      const file = join(testRoot, "agents", `metis-${r}.toml`);
      expect(existsSync(file), `Role file for ${r} must exist`).toBe(true);
      const content = readFileSync(file, "utf-8");
      expect(content).toMatch(/sandbox_mode\s*=\s*"read-only"/);
      expect(content).toMatch(new RegExp(`name\\s*=\\s*"metis_${r}"`));
    }
  });

  it("should pass doctor check on fresh install", async () => {
    await adapter.install(testRoot);
    const doc = await adapter.doctor(testRoot);

    expect(doc.provider).toBe("codex");
    expect(doc.detected).toBe(true);
    expect(doc.installed).toBe(true);
    expect(doc.bundleHashValid).toBe(true);
    expect(doc.verified).toBe(true);
    expect(doc.errors).toHaveLength(0);
    expect(doc.details.sandboxModesValid).toBe(true);
    expect(doc.details.envelopeSupported).toBe("$metis");
  });

  it("should fail doctor check if sandbox_mode is improperly modified", async () => {
    await adapter.install(testRoot);

    // Tamper with reviewer sandbox_mode to workspace-write
    const reviewerFile = join(testRoot, "agents", "metis-reviewer.toml");
    let content = readFileSync(reviewerFile, "utf-8");
    content = content.replace('sandbox_mode = "read-only"', 'sandbox_mode = "workspace-write"');
    writeFileSync(reviewerFile, content, "utf-8");

    const doc = await adapter.doctor(testRoot);
    expect(doc.verified).toBe(false);
    expect(doc.errors.some(e => e.includes("sandbox_mode mismatch"))).toBe(true);
  });

  it("should execute mission via external controller on valid install and target", async () => {
    await adapter.install(testRoot);

    const result = await controller.activate({
      provider: "codex",
      customRoot: testRoot,
      targetDir,
      mission: "Refactor database query caching layer",
    });

    expect(result.success).toBe(true);
    expect(result.provider).toBe("codex");
    expect(result.route).toBe("T1");
    expect(result.gateEvidence.length).toBe(3); // G4, G5, G6
    expect(result.gateEvidence.map(g => g.status)).toEqual(["PASS", "PASS", "VERIFIED"]);
  });

  it("should parse $metis activation envelope accurately", () => {
    const env1 = `$metis activate target=/path/to/project mission="Fix defect in auth"`;
    const parsed1 = parseCodexEnvelope(env1);
    expect(parsed1.command).toBe("activate");
    expect(parsed1.targetDir).toBe("/path/to/project");
    expect(parsed1.mission).toBe("Fix defect in auth");

    const env2 = `$metis activate target="/path/with spaces/proj" model=gpt-5 dryRun=true mission="Add feature"`;
    const parsed2 = parseCodexEnvelope(env2);
    expect(parsed2.targetDir).toBe("/path/with spaces/proj");
    expect(parsed2.model).toBe("gpt-5");
    expect(parsed2.dryRun).toBe(true);
    expect(parsed2.mission).toBe("Add feature");

    expect(() => parseCodexEnvelope("invalid envelope without prefix")).toThrow(/INVALID_ENVELOPE/);
  });

  it("should execute mission via $metis activation envelope", async () => {
    await adapter.install(testRoot);

    const envelope = `$metis activate target=${targetDir} mission="Optimize query index"`;
    const result = await adapter.activateEnvelope(envelope, controller, testRoot);

    expect(result.success).toBe(true);
    expect(result.provider).toBe("codex");
    expect(result.route).toBe("T1");
    expect(result.gateEvidence.length).toBe(3);
  });

  it("should cleanly uninstall all installed files and receipt", async () => {
    await adapter.install(testRoot);
    const uninstalled = await adapter.uninstall(testRoot);

    expect(uninstalled.success).toBe(true);
    expect(uninstalled.removedFiles.length).toBeGreaterThan(0);
    expect(existsSync(join(testRoot, ".metis-plugin-codex.json"))).toBe(false);
    expect(existsSync(join(testRoot, "skills", "metis", "SKILL.md"))).toBe(false);

    const doc = await adapter.doctor(testRoot);
    expect(doc.installed).toBe(false);
    expect(doc.verified).toBe(false);
  });

  it("should detect and inherit user configured model from config.toml in host root", async () => {
    await adapter.install(testRoot);

    // User configured Codex with a specific model in host root
    writeFileSync(join(testRoot, "config.toml"), `model = "o3-mini"\n`, "utf-8");

    const doc = await adapter.doctor(testRoot);
    expect(doc.details.activeModel).toBe("o3-mini");
    expect(doc.details.activeModelSource).toBe("host-config");

    const result = await controller.activate({
      provider: "codex",
      customRoot: testRoot,
      targetDir,
      mission: "Build rate limiting gateway",
    });

    expect(result.success).toBe(true);
    expect(result.resolvedModel.model).toBe("o3-mini");
    expect(result.resolvedModel.source).toBe("host-config");
  });

  it("should prioritize workspace project .codex/config.toml over host-level config", async () => {
    await adapter.install(testRoot);

    // Host level has one model
    writeFileSync(join(testRoot, "config.toml"), `model = "host-gpt-4o"\n`, "utf-8");

    // Workspace project has a different model
    mkdirSync(join(targetDir, ".codex"), { recursive: true });
    writeFileSync(join(targetDir, ".codex", "config.toml"), `model = "workspace-gpt-5-preview"\nthinking = true\n`, "utf-8");

    const result = await controller.activate({
      provider: "codex",
      customRoot: testRoot,
      targetDir,
      mission: "Implement schema migration",
    });

    expect(result.resolvedModel.model).toBe("workspace-gpt-5-preview");
    expect(result.resolvedModel.thinking).toBe(true);
    expect(result.resolvedModel.source).toBe("host-config");
  });

  it("should inherit model from CODEX_MODEL environment variable", async () => {
    await adapter.install(testRoot);
    const originalEnv = process.env.CODEX_MODEL;
    process.env.CODEX_MODEL = "o1-preview";

    try {
      const result = await controller.activate({
        provider: "codex",
        customRoot: testRoot,
        targetDir,
        mission: "Refactor session state",
      });

      expect(result.resolvedModel.model).toBe("o1-preview");
      expect(result.resolvedModel.source).toBe("env");
    } finally {
      if (originalEnv !== undefined) {
        process.env.CODEX_MODEL = originalEnv;
      } else {
        delete process.env.CODEX_MODEL;
      }
    }
  });

  it("should inherit active Codex model when activating via $metis envelope without model flag", async () => {
    await adapter.install(testRoot);
    writeFileSync(join(testRoot, "config.toml"), `model = "o3-mini"\n`, "utf-8");

    const envelope = `$metis activate target=${targetDir} mission="Optimize query index"`;
    const result = await adapter.activateEnvelope(envelope, controller, testRoot);

    expect(result.success).toBe(true);
    expect(result.resolvedModel.model).toBe("o3-mini");
    expect(result.resolvedModel.source).toBe("host-config");
  });

  it("should handle native inherit resolution for Codex", async () => {
    await adapter.install(testRoot);

    writeFileSync(join(testRoot, "config.toml"), `model = "inherit"\n`, "utf-8");

    const result = await controller.activate({
      provider: "codex",
      customRoot: testRoot,
      targetDir,
      mission: "Explain auth flow",
    });

    expect(result.resolvedModel.model).toBe("inherit");
    expect(result.resolvedModel.source).toBe("inherited");
  });

  it("should parse Codex TOML with inline comment and dotted key", async () => {
    await adapter.install(testRoot);

    writeFileSync(join(testRoot, "config.toml"), `chat.model = "gpt-4o-2024-11-20" # active production model\nthinking = true\n`, "utf-8");

    const doc = await adapter.doctor(testRoot);
    expect(doc.details.activeModel).toBe("gpt-4o-2024-11-20");

    const result = await controller.activate({
      provider: "codex",
      customRoot: testRoot,
      targetDir,
      mission: "Migrate schema",
    });

    expect(result.resolvedModel.model).toBe("gpt-4o-2024-11-20");
    expect(result.resolvedModel.thinking).toBe(true);
    expect(result.resolvedModel.source).toBe("host-config");
  });

  it("should parse Codex TOML with inline table", async () => {
    await adapter.install(testRoot);

    writeFileSync(join(testRoot, "config.toml"), `model = { name = "o3-mini" }\n`, "utf-8");

    const result = await controller.activate({
      provider: "codex",
      customRoot: testRoot,
      targetDir,
      mission: "Optimize query plan",
    });

    expect(result.resolvedModel.model).toBe("o3-mini");
    expect(result.resolvedModel.source).toBe("host-config");
  });

  it("should parse thinking flag and model in $metis envelope", async () => {
    await adapter.install(testRoot);

    const envelope = `$metis activate target=${targetDir} model=o1 thinking=true mission="Fix concurrency deadlock"`;
    const result = await adapter.activateEnvelope(envelope, controller, testRoot);

    expect(result.success).toBe(true);
    expect(result.resolvedModel.model).toBe("o1");
    expect(result.resolvedModel.thinking).toBe(true);
    expect(result.resolvedModel.source).toBe("explicit");
  });
});

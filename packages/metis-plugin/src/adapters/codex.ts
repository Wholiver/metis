import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { BaseAdapter, type InstallReceipt, type DoctorResult, type DetectedModelProfile, type ModelResolutionContext } from "./base.ts";
import { readJsonSafe, readTextSafe, extractModelFromJson, extractModelFromToml } from "../utils.ts";

export class CodexAdapter extends BaseAdapter {
  constructor(contractsOrDir?: any) {
    super("codex", contractsOrDir);
  }

  detectActiveModel(context?: ModelResolutionContext): DetectedModelProfile | null {
    // 1. Session settings
    if (context?.sessionSettings) {
      const extracted = extractModelFromJson(context.sessionSettings);
      if (extracted && extracted.model) {
        const isInherit = extracted.model.toLowerCase() === "inherit";
        return {
          model: isInherit ? "inherit" : extracted.model,
          thinking: extracted.thinking,
          source: isInherit ? "inherited" : "session",
          details: { from: "sessionSettings" },
        };
      }
    }

    // 2. Workspace project configuration (targetDir)
    if (context?.targetDir && existsSync(context.targetDir)) {
      const workspaceCandidates = [
        join(context.targetDir, ".codex", "config.toml"),
        join(context.targetDir, ".codex", "codex.toml"),
        join(context.targetDir, ".codex", "config.json"),
        join(context.targetDir, ".codex", "settings.json"),
        join(context.targetDir, "codex.toml"),
        join(context.targetDir, "codex.json"),
        join(context.targetDir, ".codexrc"),
        join(context.targetDir, ".codex.toml"),
      ];

      for (const candidate of workspaceCandidates) {
        if (!existsSync(candidate)) continue;
        let extracted: { model: string; thinking?: boolean } | null = null;
        if (candidate.endsWith(".json")) {
          const json = readJsonSafe(candidate);
          extracted = extractModelFromJson(json);
        } else {
          const text = readTextSafe(candidate);
          if (text) extracted = extractModelFromToml(text);
        }

        if (extracted && extracted.model) {
          const isInherit = extracted.model.toLowerCase() === "inherit";
          return {
            model: isInherit ? "inherit" : extracted.model,
            thinking: extracted.thinking,
            source: isInherit ? "inherited" : "host-config",
            detectedFrom: candidate,
            details: { scope: "workspace", file: candidate },
          };
        }
      }
    }

    // 3. Host installation configuration
    const hostRootsToCheck: string[] = [];
    try {
      const resolved = this.resolveInstallRoot(context?.customRoot);
      if (resolved) hostRootsToCheck.push(resolved);
    } catch {
      // Fallback if root cannot be resolved
    }

    if (!context?.customRoot) {
      const home = process.env.HOME || process.env.USERPROFILE || "";
      if (process.env.CODEX_CONFIG_DIR) hostRootsToCheck.push(process.env.CODEX_CONFIG_DIR);
      if (process.env.CODEX_HOME) hostRootsToCheck.push(process.env.CODEX_HOME);
      if (home) {
        hostRootsToCheck.push(join(home, ".codex"));
        hostRootsToCheck.push(join(home, ".config", "codex"));
      }
    }

    const uniqueRoots = [...new Set(hostRootsToCheck)];
    for (const hostRoot of uniqueRoots) {
      if (!existsSync(hostRoot)) continue;
      const hostCandidates = [
        join(hostRoot, "config.toml"),
        join(hostRoot, "codex.toml"),
        join(hostRoot, "config.json"),
        join(hostRoot, "settings.json"),
        join(hostRoot, ".codexrc"),
      ];

      for (const candidate of hostCandidates) {
        if (!existsSync(candidate)) continue;
        let extracted: { model: string; thinking?: boolean } | null = null;
        if (candidate.endsWith(".json")) {
          const json = readJsonSafe(candidate);
          extracted = extractModelFromJson(json);
        } else {
          const text = readTextSafe(candidate);
          if (text) extracted = extractModelFromToml(text);
        }

        if (extracted && extracted.model) {
          const isInherit = extracted.model.toLowerCase() === "inherit";
          return {
            model: isInherit ? "inherit" : extracted.model,
            thinking: extracted.thinking,
            source: isInherit ? "inherited" : "host-config",
            detectedFrom: candidate,
            details: { scope: "host", file: candidate },
          };
        }
      }
    }

    // 4. Codex-specific environment variables
    const envModel = process.env.CODEX_MODEL || process.env.CODEX_ACTIVE_MODEL || process.env.CODEX_DEFAULT_MODEL || process.env.CODEX_CHAT_MODEL;
    if (envModel && envModel.trim()) {
      const isInherit = envModel.toLowerCase() === "inherit";
      return {
        model: isInherit ? "inherit" : envModel.trim(),
        thinking: process.env.CODEX_THINKING === "true",
        source: isInherit ? "inherited" : "env",
        details: {
          envVar: process.env.CODEX_MODEL
            ? "CODEX_MODEL"
            : process.env.CODEX_ACTIVE_MODEL
            ? "CODEX_ACTIVE_MODEL"
            : process.env.CODEX_CHAT_MODEL
            ? "CODEX_CHAT_MODEL"
            : "CODEX_DEFAULT_MODEL",
        },
      };
    }

    return null;
  }


  async install(customRoot?: string): Promise<InstallReceipt> {
    const root = this.resolveInstallRoot(customRoot);
    const projection = this.projector.projectCodex(root);

    const receipt: InstallReceipt = {
      provider: "codex",
      version: "1.0.0",
      installedAt: new Date().toISOString(),
      installRoot: root,
      bundleHash: projection.bundleHash,
      launcherPath: "skills/metis/SKILL.md",
      files: projection.files.map(f => ({
        path: f.relativePath,
        sha256: f.sha256,
      })),
      roles: this.contracts.roles.map(r => r.id),
    };

    this.writeReceipt(root, receipt);
    return receipt;
  }

  async doctor(customRoot?: string): Promise<DoctorResult> {
    const root = this.resolveInstallRoot(customRoot);
    const errors: string[] = [];
    const warnings: string[] = [];
    const detected = existsSync(root);
    const receipt = this.readReceipt(root);
    const installed = !!receipt;

    if (!detected) {
      warnings.push(`Codex host root directory does not exist yet: ${root}`);
    }

    if (!installed) {
      errors.push(`Receipt not found at ${this.getReceiptPath(root)}. Run "metis-plugin install codex" first.`);
      return {
        provider: "codex",
        installRoot: root,
        detected,
        installed: false,
        verified: false,
        bundleHashValid: false,
        errors,
        warnings,
        details: {},
      };
    }

    // 1. Verify file integrity and hashes
    const integrity = this.verifyReceiptIntegrity(root, receipt);
    if (!integrity.verified) {
      errors.push(...integrity.errors);
    }

    // 2. Verify public launcher (skills/metis/SKILL.md) & In-Session Playbooks
    const launcherAbs = join(root, receipt.launcherPath || "skills/metis/SKILL.md");
    if (!existsSync(launcherAbs)) {
      errors.push(`Public skill shim missing: ${receipt.launcherPath}`);
    } else {
      const launcherContent = readFileSync(launcherAbs, "utf-8");
      if (!launcherContent.includes("Request Primacy")) {
        errors.push("Public skill missing Request Primacy invariant in skills/metis/SKILL.md");
      }
    }

    const playbooksAbs = join(root, "skills", "metis", "PLAYBOOKS.md");
    if (!existsSync(playbooksAbs)) {
      errors.push("Playbooks contract missing: skills/metis/PLAYBOOKS.md");
    }

    const gatesAbs = join(root, "skills", "metis", "GATES.md");
    if (!existsSync(gatesAbs)) {
      errors.push("Gates contract missing: skills/metis/GATES.md");
    }

    // 3. Verify TOML roles and sandbox modes
    let sandboxModesValid = true;
    for (const role of this.contracts.roles) {
      const roleFile = join(root, "agents", `metis-${role.id}.toml`);
      if (existsSync(roleFile)) {
        const content = readFileSync(roleFile, "utf-8");
        const expectedSandbox = role.codex.sandbox_mode;
        const match = /sandbox_mode\s*=\s*"([^"]+)"/.exec(content);
        if (!match) {
          errors.push(`Role metis-${role.id}.toml missing sandbox_mode attribute`);
          sandboxModesValid = false;
        } else if (match[1] !== expectedSandbox) {
          errors.push(`Role metis-${role.id}.toml sandbox_mode mismatch: expected "${expectedSandbox}", found "${match[1]}"`);
          sandboxModesValid = false;
        }
      }
    }

    // 4. Verify bundle hash
    const bundleHashFile = join(root, ".metis-plugin", "bundle", "bundle.hash");
    let bundleHashValid = false;
    if (existsSync(bundleHashFile)) {
      try {
        const hashObj = JSON.parse(readFileSync(bundleHashFile, "utf-8"));
        bundleHashValid = hashObj.bundleHash === receipt.bundleHash;
        if (!bundleHashValid) {
          errors.push(`Bundle hash mismatch: expected ${receipt.bundleHash}, found ${hashObj.bundleHash}`);
        }
      } catch (e: any) {
        errors.push(`Could not read bundle.hash: ${e.message}`);
      }
    } else {
      errors.push(`Private bundle hash file missing at ${bundleHashFile}`);
    }

    const detectedModel = this.detectActiveModel({ customRoot: root });

    return {
      provider: "codex",
      installRoot: root,
      detected,
      installed: true,
      verified: errors.length === 0,
      bundleHashValid,
      errors,
      warnings,
      details: {
        sandboxModesValid,
        envelopeSupported: "$metis",
        filesChecked: receipt.files.length,
        activeModel: detectedModel ? detectedModel.model : undefined,
        activeModelSource: detectedModel ? detectedModel.source : undefined,
      },
    };
  }

  parseEnvelope(envelopeText: string): ParsedCodexEnvelope {
    return parseCodexEnvelope(envelopeText);
  }

  async activateEnvelope(envelopeText: string, controller: any, customRoot?: string, sessionSettings?: Record<string, any>) {
    const parsed = this.parseEnvelope(envelopeText);
    if (!parsed.targetDir) {
      throw new Error(`INVALID_ENVELOPE: Target directory not specified in envelope (e.g. target=/abs/path)`);
    }
    if (!parsed.mission) {
      throw new Error(`INVALID_ENVELOPE: Mission not specified in envelope (e.g. mission="Fix defect")`);
    }
    return controller.activate({
      provider: "codex",
      targetDir: parsed.targetDir,
      mission: parsed.mission,
      model: parsed.model,
      thinking: parsed.thinking,
      dryRun: parsed.dryRun,
      customRoot,
      sessionSettings,
    });
  }
}

export interface ParsedCodexEnvelope {
  command: string;
  targetDir?: string;
  mission?: string;
  model?: string;
  thinking?: boolean;
  dryRun?: boolean;
}

export function parseCodexEnvelope(envelopeText: string): ParsedCodexEnvelope {
  let trimmed = envelopeText.trim();
  if (trimmed.startsWith("$metis")) {
    trimmed = trimmed.slice(6).trim();
  } else if (!trimmed.startsWith("activate") && !trimmed.includes("target=")) {
    throw new Error(`INVALID_ENVELOPE: Codex activation envelope must begin with '$metis', found: "${trimmed.slice(0, 20)}"`);
  }

  const tokens = trimmed.split(/\s+/);
  const command = tokens[0] === "activate" ? "activate" : "activate";

  const result: ParsedCodexEnvelope = {
    command,
  };

  const targetMatch = /target=(?:"([^"]+)"|'([^']+)'|([^\s]+))/.exec(trimmed);
  if (targetMatch) {
    result.targetDir = targetMatch[1] || targetMatch[2] || targetMatch[3];
  }

  const missionMatch = /mission=(?:"([^"]+)"|'([^']+)'|([^\s].*))/.exec(trimmed);
  if (missionMatch) {
    result.mission = missionMatch[1] || missionMatch[2] || missionMatch[3];
  }

  const modelMatch = /model=(?:"([^"]+)"|'([^']+)'|([^\s]+))/.exec(trimmed);
  if (modelMatch) {
    result.model = modelMatch[1] || modelMatch[2] || modelMatch[3];
  }

  if (/thinking=true|--thinking/.test(trimmed)) {
    result.thinking = true;
  } else if (/thinking=false/.test(trimmed)) {
    result.thinking = false;
  }

  if (/dryRun=true|--dry-run/.test(trimmed)) {
    result.dryRun = true;
  }

  return result;
}

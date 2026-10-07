import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { BaseAdapter, type InstallReceipt, type DoctorResult, type DetectedModelProfile, type ModelResolutionContext } from "./base.ts";
import { parseYamlFrontmatter, readJsonSafe, readTextSafe, extractModelFromJson, extractModelFromToml } from "../utils.ts";

export class OpenCodeAdapter extends BaseAdapter {
  constructor(contractsOrDir?: any) {
    super("opencode", contractsOrDir);
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
        join(context.targetDir, ".opencode", "opencode.json"),
        join(context.targetDir, ".opencode", "config.json"),
        join(context.targetDir, ".opencode", "settings.json"),
        join(context.targetDir, ".opencode", "opencode.toml"),
        join(context.targetDir, ".opencode", "config.toml"),
        join(context.targetDir, "opencode.json"),
        join(context.targetDir, "opencode.toml"),
        join(context.targetDir, ".opencode.json"),
        join(context.targetDir, ".opencode.toml"),
        join(context.targetDir, ".vscode", "settings.json"),
      ];

      for (const candidate of workspaceCandidates) {
        if (!existsSync(candidate)) continue;
        let extracted: { model: string; thinking?: boolean } | null = null;
        if (candidate.endsWith(".json")) {
          const json = readJsonSafe(candidate);
          extracted = extractModelFromJson(json);
        } else if (candidate.endsWith(".toml")) {
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
      if (process.env.OPENCODE_CONFIG_DIR) hostRootsToCheck.push(process.env.OPENCODE_CONFIG_DIR);
      if (process.env.OPENCODE_HOME) hostRootsToCheck.push(process.env.OPENCODE_HOME);
      if (home) {
        hostRootsToCheck.push(join(home, ".opencode"));
        hostRootsToCheck.push(join(home, ".config", "opencode"));
      }
    }

    const uniqueRoots = [...new Set(hostRootsToCheck)];
    for (const hostRoot of uniqueRoots) {
      if (!existsSync(hostRoot)) continue;
      const hostCandidates = [
        join(hostRoot, "opencode.json"),
        join(hostRoot, "config.json"),
        join(hostRoot, "settings.json"),
        join(hostRoot, "opencode.toml"),
        join(hostRoot, "config.toml"),
      ];

      for (const candidate of hostCandidates) {
        if (!existsSync(candidate)) continue;
        let extracted: { model: string; thinking?: boolean } | null = null;
        if (candidate.endsWith(".json")) {
          const json = readJsonSafe(candidate);
          extracted = extractModelFromJson(json);
        } else if (candidate.endsWith(".toml")) {
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

    // 4. OpenCode-specific environment variables
    const envModel = process.env.OPENCODE_MODEL || process.env.OPENCODE_ACTIVE_MODEL || process.env.OPENCODE_DEFAULT_MODEL || process.env.OPENCODE_CHAT_MODEL;
    if (envModel && envModel.trim()) {
      const isInherit = envModel.toLowerCase() === "inherit";
      return {
        model: isInherit ? "inherit" : envModel.trim(),
        thinking: process.env.OPENCODE_THINKING === "true",
        source: isInherit ? "inherited" : "env",
        details: {
          envVar: process.env.OPENCODE_MODEL
            ? "OPENCODE_MODEL"
            : process.env.OPENCODE_ACTIVE_MODEL
            ? "OPENCODE_ACTIVE_MODEL"
            : process.env.OPENCODE_CHAT_MODEL
            ? "OPENCODE_CHAT_MODEL"
            : "OPENCODE_DEFAULT_MODEL",
        },
      };
    }

    return null;
  }


  async install(customRoot?: string): Promise<InstallReceipt> {
    const root = this.resolveInstallRoot(customRoot);
    const projection = this.projector.projectOpenCode(root);

    const receipt: InstallReceipt = {
      provider: "opencode",
      version: "1.0.0",
      installedAt: new Date().toISOString(),
      installRoot: root,
      bundleHash: projection.bundleHash,
      launcherPath: "commands/metis.md",
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
      warnings.push(`OpenCode host root directory does not exist yet: ${root}`);
    }

    if (!installed) {
      errors.push(`Receipt not found at ${this.getReceiptPath(root)}. Run "metis-plugin install opencode" first.`);
      return {
        provider: "opencode",
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

    // 2. Verify public launcher & In-Session Playbooks
    const launcherAbs = join(root, receipt.launcherPath || "commands/metis.md");
    if (!existsSync(launcherAbs)) {
      errors.push(`Public launcher missing: ${receipt.launcherPath}`);
    } else {
      const launcherContent = readFileSync(launcherAbs, "utf-8");
      if (!launcherContent.includes("Request Primacy")) {
        errors.push(`Public launcher missing Request Primacy invariant in ${receipt.launcherPath}`);
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

    // 3. Verify roles guardrails: mode: subagent, deny task/skill
    let permissionsValid = true;
    for (const role of this.contracts.roles) {
      const roleFile = join(root, "agents", `metis-${role.id}.md`);
      if (existsSync(roleFile)) {
        const content = readFileSync(roleFile, "utf-8");
        const parsed = parseYamlFrontmatter<any>(content);
        if (parsed.data.mode !== "subagent") {
          errors.push(`Role metis-${role.id}.md must have "mode: subagent", found "${parsed.data.mode}"`);
          permissionsValid = false;
        }
        const perms = parsed.data.permission || {};
        if (perms.task !== "deny") {
          errors.push(`Role metis-${role.id}.md must deny "task" permission (found: ${perms.task})`);
          permissionsValid = false;
        }
        if (perms.skill !== "deny") {
          errors.push(`Role metis-${role.id}.md must deny "skill" permission (found: ${perms.skill})`);
          permissionsValid = false;
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
      provider: "opencode",
      installRoot: root,
      detected,
      installed: true,
      verified: errors.length === 0,
      bundleHashValid,
      errors,
      warnings,
      details: {
        permissionsValid,
        nativeDispatchAllowed: false,
        filesChecked: receipt.files.length,
        activeModel: detectedModel ? detectedModel.model : undefined,
        activeModelSource: detectedModel ? detectedModel.source : undefined,
      },
    };
  }
}

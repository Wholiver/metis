import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { BaseAdapter, type InstallReceipt, type DoctorResult, type DetectedModelProfile, type ModelResolutionContext } from "./base.ts";
import { readJsonSafe, readTextSafe, extractModelFromJson, extractModelFromToml } from "../utils.ts";
import { CordisBridge } from "../cordis-bridge/index.ts";

export class DeepSeekAdapter extends BaseAdapter {
  constructor(contractsOrDir?: any) {
    super("deepseek", contractsOrDir);
  }

  detectActiveModel(context?: ModelResolutionContext): DetectedModelProfile | null {
    // 1. Session settings
    if (context?.sessionSettings) {
      const extracted = extractModelFromJson(context.sessionSettings);
      if (extracted && extracted.model) {
        const isInherit = extracted.model.toLowerCase() === "inherit";
        const isReasoner = /reasoner|r1|thought|reasoning/i.test(extracted.model);
        const thinking = context.sessionSettings.thinking !== undefined
          ? (typeof context.sessionSettings.thinking === "boolean" ? context.sessionSettings.thinking : context.sessionSettings.thinking === "true")
          : (extracted.thinking !== undefined ? extracted.thinking : (isReasoner ? true : undefined));
        return {
          model: isInherit ? "inherit" : extracted.model,
          thinking,
          source: isInherit ? "inherited" : "session",
          details: { from: "sessionSettings" },
        };
      }
    }

    // 2. Workspace project configuration (targetDir)
    if (context?.targetDir && existsSync(context.targetDir)) {
      const workspaceCandidates = [
        join(context.targetDir, ".dsh", "config.json"),
        join(context.targetDir, ".dsh", "settings.json"),
        join(context.targetDir, ".dsh", "deepseek.json"),
        join(context.targetDir, ".deepseek", "config.json"),
        join(context.targetDir, ".deepseek", "settings.json"),
        join(context.targetDir, "deepseek.json"),
        join(context.targetDir, "dsh.json"),
        join(context.targetDir, ".deepseekrc"),
        join(context.targetDir, "deepseek.toml"),
        join(context.targetDir, "dsh.toml"),
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
          const isReasoner = /reasoner|r1|thought|reasoning/i.test(extracted.model);
          const thinking = extracted.thinking !== undefined ? extracted.thinking : (isReasoner ? true : undefined);
          return {
            model: isInherit ? "inherit" : extracted.model,
            thinking,
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
      if (process.env.DSH_HOME) hostRootsToCheck.push(process.env.DSH_HOME);
      if (process.env.DEEPSEEK_HOME) hostRootsToCheck.push(process.env.DEEPSEEK_HOME);
      if (home) {
        hostRootsToCheck.push(join(home, ".dsh"));
        hostRootsToCheck.push(join(home, ".deepseek"));
        hostRootsToCheck.push(join(home, ".config", "deepseek"));
        hostRootsToCheck.push(join(home, ".config", "dsh"));
      }
    }

    const uniqueRoots = [...new Set(hostRootsToCheck)];
    for (const hostRoot of uniqueRoots) {
      if (!existsSync(hostRoot)) continue;
      const hostCandidates = [
        join(hostRoot, "config.json"),
        join(hostRoot, "dsh.json"),
        join(hostRoot, "settings.json"),
        join(hostRoot, "deepseek.json"),
        join(hostRoot, "cordis.json"),
        join(hostRoot, "config.toml"),
        join(hostRoot, "deepseek.toml"),
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
          const isReasoner = /reasoner|r1|thought|reasoning/i.test(extracted.model);
          const thinking = extracted.thinking !== undefined ? extracted.thinking : (isReasoner ? true : undefined);
          return {
            model: isInherit ? "inherit" : extracted.model,
            thinking,
            source: isInherit ? "inherited" : "host-config",
            detectedFrom: candidate,
            details: { scope: "host", file: candidate },
          };
        }
      }
    }

    // 4. DeepSeek / DSH environment variables
    const envModel = process.env.DEEPSEEK_MODEL
      || process.env.DSH_MODEL
      || process.env.DEEPSEEK_ACTIVE_MODEL
      || process.env.DSH_ACTIVE_MODEL
      || process.env.DEEPSEEK_DEFAULT_MODEL
      || process.env.CORDIS_MODEL
      || process.env.DEEPSEEK_REASONER_MODEL;
    if (envModel && envModel.trim()) {
      const isInherit = envModel.toLowerCase() === "inherit";
      const isReasoner = /reasoner|r1|thought|reasoning/i.test(envModel);
      const thinking = process.env.DEEPSEEK_THINKING !== undefined
        ? process.env.DEEPSEEK_THINKING === "true"
        : (isReasoner ? true : undefined);
      return {
        model: isInherit ? "inherit" : envModel.trim(),
        thinking,
        source: isInherit ? "inherited" : "env",
        details: {
          envVar: process.env.DEEPSEEK_MODEL
            ? "DEEPSEEK_MODEL"
            : process.env.DSH_MODEL
            ? "DSH_MODEL"
            : process.env.DEEPSEEK_ACTIVE_MODEL
            ? "DEEPSEEK_ACTIVE_MODEL"
            : process.env.DSH_ACTIVE_MODEL
            ? "DSH_ACTIVE_MODEL"
            : process.env.CORDIS_MODEL
            ? "CORDIS_MODEL"
            : process.env.DEEPSEEK_REASONER_MODEL
            ? "DEEPSEEK_REASONER_MODEL"
            : "DEEPSEEK_DEFAULT_MODEL",
        },
      };
    }

    return null;
  }


  async install(customRoot?: string): Promise<InstallReceipt> {
    const root = this.resolveInstallRoot(customRoot);
    const projection = this.projector.projectDeepSeek(root);

    const receipt: InstallReceipt = {
      provider: "deepseek",
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
      warnings.push(`DeepSeek Harness host root directory does not exist yet: ${root}`);
    }

    if (!installed) {
      errors.push(`Receipt not found at ${this.getReceiptPath(root)}. Run "metis-plugin install deepseek" first.`);
      return {
        provider: "deepseek",
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

    // 3. Verify Cordis SDK bridge (MANDATORY in production - fails closed if missing!)
    const bridgePath = join(root, "cordis-bridge", "index.js");
    let cordisBridgeValid = false;
    if (!existsSync(bridgePath)) {
      errors.push(`FAIL_CLOSED: Mandatory owned Cordis SDK bridge missing at ${bridgePath}. DeepSeek production path requires owned Cordis bridge.`);
    } else {
      try {
        const bridgeContent = readFileSync(bridgePath, "utf-8");
        const requiredSymbols = ["CordisBridge", "OwnedTools", "createCordisBridge", "OWNED_TOOLS"];
        const missingSymbols = requiredSymbols.filter(sym => !bridgeContent.includes(sym));
        const requiredTools = ["read", "write", "edit", "bash", "grep", "find", "ls"];
        const missingTools = requiredTools.filter(t => !bridgeContent.includes(`"${t}"`) && !bridgeContent.includes(`'${t}'`));

        if (missingSymbols.length > 0 || missingTools.length > 0) {
          errors.push(`FAIL_CLOSED: Installed Cordis SDK bridge at ${bridgePath} is incomplete. Missing: ${[...missingSymbols, ...missingTools].join(", ")}`);
        } else {
          const bridge = new CordisBridge({ workspaceRoot: root });
          const check = bridge.healthCheck();
          if (check.ok && check.tools.length >= 7) {
            cordisBridgeValid = true;
          } else {
            errors.push(`FAIL_CLOSED: Cordis SDK bridge health check failed`);
          }
        }
      } catch (err: any) {
        errors.push(`FAIL_CLOSED: Cordis SDK bridge verification error: ${err.message}`);
      }
    }

    // 4. Verify compatibility presets
    for (const role of this.contracts.roles) {
      const presetFile = join(root, "agent-preset", `metis-${role.id}.json`);
      if (!existsSync(presetFile)) {
        warnings.push(`Compatibility preset missing: agent-preset/metis-${role.id}.json`);
      }
    }

    // 5. Verify bundle hash
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
      provider: "deepseek",
      installRoot: root,
      detected,
      installed: true,
      verified: errors.length === 0,
      bundleHashValid,
      errors,
      warnings,
      details: {
        cordisBridgeValid,
        productionPath: "owned-cordis-bridge",
        compatibilityPresets: "agent-preset",
        filesChecked: receipt.files.length,
        activeModel: detectedModel ? detectedModel.model : undefined,
        activeModelSource: detectedModel ? detectedModel.source : undefined,
      },
    };
  }

  getCordisBridge(workspaceRoot: string): CordisBridge {
    return new CordisBridge({ workspaceRoot });
  }
}

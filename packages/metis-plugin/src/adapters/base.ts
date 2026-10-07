import { existsSync, readFileSync, rmSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { homedir } from "node:os";
import { Projector, computeSha256 } from "../projector.ts";
import { loadContracts, type ContractsBundle, type ProviderContract } from "../contracts.ts";

export interface FileReceipt {
  path: string;
  sha256: string;
}

export interface InstallReceipt {
  provider: string;
  version: string;
  installedAt: string;
  installRoot: string;
  bundleHash: string;
  launcherPath: string;
  files: FileReceipt[];
  roles: string[];
}

export interface DoctorResult {
  provider: string;
  installRoot: string;
  detected: boolean;
  installed: boolean;
  verified: boolean;
  bundleHashValid: boolean;
  errors: string[];
  warnings: string[];
  details: Record<string, any>;
}

export interface UninstallResult {
  provider: string;
  removedFiles: string[];
  success: boolean;
}

export interface DetectedModelProfile {
  model: string;
  thinking?: boolean;
  source: "host-active" | "host-config" | "session" | "inherited" | "env";
  detectedFrom?: string;
  details?: Record<string, any>;
}

export interface ModelResolutionContext {
  targetDir?: string;
  customRoot?: string;
  sessionSettings?: Record<string, any>;
}

export interface ActivateOptions {
  targetDir: string;
  mission: string;
  model?: string;
  thinking?: string | boolean;
  customRoot?: string;
  dryRun?: boolean;
  verbose?: boolean;
  sessionSettings?: Record<string, any>;
}

export class BaseAdapter {

  protected contracts: ContractsBundle;
  protected projector: Projector;
  protected providerConfig: ProviderContract;

  public readonly providerId: string;

  constructor(
    providerId: string,
    contractsOrDir?: ContractsBundle | string
  ) {
    this.providerId = providerId;
    this.contracts = typeof contractsOrDir === "string" || !contractsOrDir
      ? loadContracts(contractsOrDir)
      : contractsOrDir;
    this.projector = new Projector(this.contracts);
    const config = this.contracts.providers[providerId];
    if (!config) {
      throw new Error(`PROVIDER_UNSUPPORTED: Provider "${providerId}" is not configured in contracts.`);
    }
    this.providerConfig = config;
  }

  resolveInstallRoot(customRoot?: string): string {
    if (customRoot) {
      return resolve(customRoot);
    }
    if (process.env.METIS_PLUGIN_INSTALL_ROOT) {
      return resolve(process.env.METIS_PLUGIN_INSTALL_ROOT);
    }
    if (this.providerConfig.defaultHomeEnv && process.env[this.providerConfig.defaultHomeEnv]) {
      const base = process.env[this.providerConfig.defaultHomeEnv]!;
      return this.providerConfig.defaultSubpath ? resolve(base, this.providerConfig.defaultSubpath) : resolve(base);
    }
    if (this.providerConfig.fallbackPath) {
      const fallback = this.providerConfig.fallbackPath.replace(/^~/, homedir());
      return resolve(fallback);
    }
    throw new Error(`Cannot determine install root for provider "${this.providerId}"`);
  }

  getReceiptPath(installRoot: string): string {
    const filename = this.providerConfig.receiptFile || `.metis-plugin-${this.providerId}.json`;
    return join(installRoot, filename);
  }

  readReceipt(installRoot: string): InstallReceipt | null {
    const p = this.getReceiptPath(installRoot);
    if (!existsSync(p)) return null;
    try {
      return JSON.parse(readFileSync(p, "utf-8"));
    } catch {
      return null;
    }
  }

  writeReceipt(installRoot: string, receipt: InstallReceipt): void {
    const p = this.getReceiptPath(installRoot);
    mkdirSync(installRoot, { recursive: true });
    writeFileSync(p, JSON.stringify(receipt, null, 2), "utf-8");
  }

  detectActiveModel(context?: ModelResolutionContext): DetectedModelProfile | null {
    return null;
  }

  async install(customRoot?: string): Promise<InstallReceipt> {
    throw new Error("install() not implemented in BaseAdapter subclass");
  }

  async doctor(customRoot?: string): Promise<DoctorResult> {
    throw new Error("doctor() not implemented in BaseAdapter subclass");
  }

  async uninstall(customRoot?: string): Promise<UninstallResult> {
    const root = this.resolveInstallRoot(customRoot);
    const receipt = this.readReceipt(root);
    const removed: string[] = [];

    if (receipt) {
      for (const f of receipt.files) {
        const abs = join(root, f.path);
        if (existsSync(abs)) {
          rmSync(abs, { force: true });
          removed.push(f.path);
        }
      }
        const receiptPath = this.getReceiptPath(root);
        if (existsSync(receiptPath)) {
          rmSync(receiptPath, { force: true });
          removed.push(this.providerConfig.receiptFile || `.metis-plugin-${this.providerId}.json`);
        }

        // Clean up bundle dir if empty
        const bundleDir = join(root, ".metis-plugin");
        if (existsSync(bundleDir)) {
          rmSync(bundleDir, { recursive: true, force: true });
          removed.push(".metis-plugin");
        }

        // Clean up empty directories created by the plugin
        for (const f of receipt.files) {
          let parentDir = dirname(join(root, f.path));
          while (parentDir !== root && parentDir.startsWith(root)) {
            if (existsSync(parentDir)) {
              try {
                const remaining = readdirSync(parentDir);
                if (remaining.length === 0) {
                  rmSync(parentDir, { recursive: true, force: true });
                }
              } catch {
                // ignore
              }
            }
            parentDir = dirname(parentDir);
          }
        }
      }

    return {
      provider: this.providerId,
      removedFiles: removed,
      success: true,
    };
  }

  protected verifyReceiptIntegrity(root: string, receipt: InstallReceipt): { verified: boolean; errors: string[] } {
    const errors: string[] = [];
    for (const f of receipt.files) {
      const abs = join(root, f.path);
      if (!existsSync(abs)) {
        errors.push(`Missing installed file: ${f.path}`);
        continue;
      }
      const content = readFileSync(abs, "utf-8");
      const hash = computeSha256(content);
      if (hash !== f.sha256) {
        errors.push(`Hash mismatch in ${f.path}: expected ${f.sha256.slice(0, 8)}..., got ${hash.slice(0, 8)}...`);
      }
    }
    return {
      verified: errors.length === 0,
      errors,
    };
  }
}

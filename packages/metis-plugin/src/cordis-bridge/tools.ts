import { readFileSync, writeFileSync, existsSync, readdirSync, statSync, realpathSync, mkdirSync } from "node:fs";
import { resolve, join, relative, isAbsolute, dirname, basename } from "node:path";
import { execSync } from "node:child_process";

export interface ToolExecutionResult {
  success: boolean;
  output?: string;
  error?: string;
}

export class OwnedTools {
  private workspaceRoot: string;

  constructor(workspaceRoot: string) {
    this.workspaceRoot = workspaceRoot;
  }

  private canonicalize(p: string): string {
    try {
      if (existsSync(p)) {
        return realpathSync(p);
      }
      const parent = dirname(p);
      if (existsSync(parent)) {
        return join(realpathSync(parent), basename(p));
      }
    } catch {
      // Fallback
    }
    return resolve(p);
  }

  private assertSafePath(targetPath: string): string {
    const rawAbs = isAbsolute(targetPath) ? targetPath : resolve(this.workspaceRoot, targetPath);
    const canonicalWs = this.canonicalize(this.workspaceRoot);
    const canonicalTarget = this.canonicalize(rawAbs);

    const relRaw = relative(this.workspaceRoot, rawAbs);
    const relCanonical = relative(canonicalWs, canonicalTarget);

    const escapesRaw = relRaw.startsWith("..") || isAbsolute(relRaw);
    const escapesCanonical = relCanonical.startsWith("..") || isAbsolute(relCanonical);

    if (escapesRaw && escapesCanonical) {
      throw new Error(`SECURITY_VIOLATION: Path "${targetPath}" escapes workspace root "${this.workspaceRoot}"`);
    }
    return rawAbs;
  }

  read(args: { path: string }): ToolExecutionResult {
    try {
      const safePath = this.assertSafePath(args.path);
      if (!existsSync(safePath)) {
        return { success: false, error: `File not found: ${args.path}` };
      }
      const content = readFileSync(safePath, "utf-8");
      return { success: true, output: content };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  write(args: { path: string; content: string }): ToolExecutionResult {
    try {
      const safePath = this.assertSafePath(args.path);
      mkdirSync(dirname(safePath), { recursive: true });
      writeFileSync(safePath, args.content, "utf-8");
      return { success: true, output: `Successfully wrote ${args.content.length} bytes to ${args.path}` };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  edit(args: { path: string; oldText: string; newText: string }): ToolExecutionResult {
    try {
      const safePath = this.assertSafePath(args.path);
      if (!existsSync(safePath)) {
        return { success: false, error: `File not found: ${args.path}` };
      }
      const content = readFileSync(safePath, "utf-8");
      if (!content.includes(args.oldText)) {
        return { success: false, error: `Target text to replace not found in ${args.path}` };
      }
      const updated = content.replace(args.oldText, () => args.newText);
      writeFileSync(safePath, updated, "utf-8");
      return { success: true, output: `Successfully updated ${args.path}` };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  bash(args: { command: string }): ToolExecutionResult {
    try {
      const output = execSync(args.command, {
        cwd: this.workspaceRoot,
        encoding: "utf-8",
        timeout: 60000,
        env: {
          ...process.env,
          WORKSPACE_ROOT: this.workspaceRoot,
        },
      });
      return { success: true, output };
    } catch (err: any) {
      const stderrStr = err.stderr ? String(err.stderr).trim() : "";
      const stdoutStr = err.stdout ? String(err.stdout).trim() : "";
      const errorMsg = stderrStr || stdoutStr || err.message;
      return {
        success: false,
        output: stdoutStr || undefined,
        error: errorMsg,
      };
    }
  }

  ls(args?: { path?: string }): ToolExecutionResult {
    try {
      const targetDir = args?.path ? this.assertSafePath(args.path) : this.workspaceRoot;
      if (!existsSync(targetDir)) {
        return { success: false, error: `Directory not found: ${args?.path || "."}` };
      }
      const entries = readdirSync(targetDir, { withFileTypes: true });
      const list = entries.map(e => `${e.isDirectory() ? "[DIR]" : "[FILE]"} ${e.name}`).join("\n");
      return { success: true, output: list };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  find(args: { pattern: string; path?: string }): ToolExecutionResult {
    try {
      const baseDir = args.path ? this.assertSafePath(args.path) : this.workspaceRoot;
      if (!existsSync(baseDir)) {
        return { success: false, error: `Directory not found: ${args.path || "."}` };
      }
      const results: string[] = [];

      // Convert glob pattern to regex safely
      const escaped = args.pattern
        .replace(/[.+^${}()|[\]\\]/g, "\\$&")
        .replace(/\*/g, ".*")
        .replace(/\?/g, ".");
      const regex = new RegExp(`^${escaped}$`, "i");
      const visitedInodes = new Set<string>();

      function walk(current: string, depth: number) {
        if (depth > 20) return;
        try {
          const stats = statSync(current);
          const inodeKey = `${stats.dev}:${stats.ino}`;
          if (visitedInodes.has(inodeKey)) return;
          visitedInodes.add(inodeKey);

          const items = readdirSync(current, { withFileTypes: true });
          for (const item of items) {
            if (item.name === "node_modules" || item.name === ".git") continue;
            const fullPath = join(current, item.name);
            if (regex.test(item.name)) {
              results.push(fullPath);
            }
            if (item.isDirectory() && !item.isSymbolicLink()) {
              walk(fullPath, depth + 1);
            }
          }
        } catch {
          // Skip unreadable directories
        }
      }

      walk(baseDir, 0);
      return { success: true, output: results.join("\n") };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  grep(args: { query: string; path?: string }): ToolExecutionResult {
    try {
      const baseDir = args.path ? this.assertSafePath(args.path) : this.workspaceRoot;
      if (!existsSync(baseDir)) {
        return { success: false, error: `Directory not found: ${args.path || "."}` };
      }
      const matches: string[] = [];
      const visitedInodes = new Set<string>();

      function searchDir(current: string, depth: number) {
        if (depth > 20) return;
        try {
          const stats = statSync(current);
          const inodeKey = `${stats.dev}:${stats.ino}`;
          if (visitedInodes.has(inodeKey)) return;
          visitedInodes.add(inodeKey);

          const items = readdirSync(current, { withFileTypes: true });
          for (const item of items) {
            if (item.name === "node_modules" || item.name === ".git") continue;
            const fullPath = join(current, item.name);
            if (item.isDirectory() && !item.isSymbolicLink()) {
              searchDir(fullPath, depth + 1);
            } else if (!item.isDirectory()) {
              try {
                const text = readFileSync(fullPath, "utf-8");
                const lines = text.split("\n");
                lines.forEach((line, idx) => {
                  if (line.includes(args.query)) {
                    matches.push(`${fullPath}:${idx + 1}: ${line.trim()}`);
                  }
                });
              } catch {
                // Ignore binary files
              }
            }
          }
        } catch {
          // Skip unreadable directories
        }
      }

      searchDir(baseDir, 0);
      return { success: true, output: matches.slice(0, 100).join("\n") };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }
}

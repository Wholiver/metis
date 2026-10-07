import { OwnedTools, type ToolExecutionResult } from "./tools.ts";

export interface CordisBridgeOptions {
  workspaceRoot: string;
  allowedTools?: string[];
}

export class CordisBridge {
  private tools: OwnedTools;
  private allowedTools?: Set<string>;
  private options: CordisBridgeOptions;

  constructor(options: CordisBridgeOptions) {
    this.options = options;
    this.tools = new OwnedTools(options.workspaceRoot);
    if (options.allowedTools) {
      this.allowedTools = new Set(options.allowedTools);
    }
  }

  isAvailable(): boolean {
    return true;
  }

  getToolDefinitions(): Array<{ name: string; description: string }> {
    const list = [
      { name: "read", description: "Read file content from workspace" },
      { name: "write", description: "Write content to a file in workspace" },
      { name: "edit", description: "Replace text in a file in workspace" },
      { name: "bash", description: "Execute a command in workspace" },
      { name: "grep", description: "Search for query in workspace files" },
      { name: "find", description: "Find files matching pattern" },
      { name: "ls", description: "List files and directories" },
    ];
    if (this.allowedTools) {
      return list.filter(t => this.allowedTools!.has(t.name));
    }
    return list;
  }

  invokeTool(toolName: string, args: Record<string, any>): ToolExecutionResult {
    if (this.allowedTools && !this.allowedTools.has(toolName)) {
      return {
        success: false,
        error: `TOOL_DENIED: Tool "${toolName}" is not permitted for this agent context`,
      };
    }

    switch (toolName) {
      case "read":
        return this.tools.read(args as { path: string });
      case "write":
        return this.tools.write(args as { path: string; content: string });
      case "edit":
        return this.tools.edit(args as { path: string; oldText: string; newText: string });
      case "bash":
        return this.tools.bash(args as { command: string });
      case "grep":
        return this.tools.grep(args as { query: string; path?: string });
      case "find":
        return this.tools.find(args as { pattern: string; path?: string });
      case "ls":
        return this.tools.ls(args as { path?: string });
      default:
        return {
          success: false,
          error: `UNKNOWN_TOOL: Tool "${toolName}" is not provided by Cordis SDK bridge`,
        };
    }
  }

  healthCheck(): { ok: boolean; version: string; tools: string[] } {
    return {
      ok: true,
      version: "1.0.0",
      tools: this.getToolDefinitions().map(t => t.name),
    };
  }
}

export const CORDIS_BRIDGE_VERSION = "1.0.0";
export const OWNED_TOOLS = ["read", "write", "edit", "bash", "grep", "find", "ls"];

export function createCordisBridge(workspaceRoot: string, options?: Partial<CordisBridgeOptions>): CordisBridge {
  return new CordisBridge({ workspaceRoot, ...options });
}

export function generateCordisBridgeBundleCode(): string {
  return `// Owned Cordis SDK Bridge for DeepSeek Harness
// Provides controller-owned tools for host-isolated execution.
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync, realpathSync, mkdirSync } from "node:fs";
import { resolve, join, relative, isAbsolute, dirname, basename } from "node:path";
import { execSync } from "node:child_process";

export const CORDIS_BRIDGE_VERSION = "1.0.0";
export const OWNED_TOOLS = ["read", "write", "edit", "bash", "grep", "find", "ls"];

export class OwnedTools {
  constructor(workspaceRoot) {
    this.workspaceRoot = workspaceRoot;
  }

  canonicalize(p) {
    try {
      if (existsSync(p)) return realpathSync(p);
      const parent = dirname(p);
      if (existsSync(parent)) return join(realpathSync(parent), basename(p));
    } catch {}
    return resolve(p);
  }

  assertSafePath(targetPath) {
    const rawAbs = isAbsolute(targetPath) ? targetPath : resolve(this.workspaceRoot, targetPath);
    const canonicalWs = this.canonicalize(this.workspaceRoot);
    const canonicalTarget = this.canonicalize(rawAbs);

    const relRaw = relative(this.workspaceRoot, rawAbs);
    const relCanonical = relative(canonicalWs, canonicalTarget);

    if ((relRaw.startsWith("..") || isAbsolute(relRaw)) && (relCanonical.startsWith("..") || isAbsolute(relCanonical))) {
      throw new Error("SECURITY_VIOLATION: Path \\"" + targetPath + "\\" escapes workspace root \\"" + this.workspaceRoot + "\\"");
    }
    return rawAbs;
  }

  read(args) {
    try {
      const safePath = this.assertSafePath(args.path);
      if (!existsSync(safePath)) return { success: false, error: "File not found: " + args.path };
      return { success: true, output: readFileSync(safePath, "utf-8") };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  write(args) {
    try {
      const safePath = this.assertSafePath(args.path);
      mkdirSync(dirname(safePath), { recursive: true });
      writeFileSync(safePath, args.content, "utf-8");
      return { success: true, output: "Successfully wrote " + args.content.length + " bytes to " + args.path };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  edit(args) {
    try {
      const safePath = this.assertSafePath(args.path);
      if (!existsSync(safePath)) return { success: false, error: "File not found: " + args.path };
      const content = readFileSync(safePath, "utf-8");
      if (!content.includes(args.oldText)) return { success: false, error: "Target text to replace not found in " + args.path };
      const updated = content.replace(args.oldText, () => args.newText);
      writeFileSync(safePath, updated, "utf-8");
      return { success: true, output: "Successfully updated " + args.path };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  bash(args) {
    try {
      const output = execSync(args.command, {
        cwd: this.workspaceRoot,
        encoding: "utf-8",
        timeout: 60000,
        env: { ...process.env, WORKSPACE_ROOT: this.workspaceRoot },
      });
      return { success: true, output };
    } catch (err) {
      const stderrStr = err.stderr ? String(err.stderr).trim() : "";
      const stdoutStr = err.stdout ? String(err.stdout).trim() : "";
      return { success: false, output: stdoutStr || undefined, error: stderrStr || stdoutStr || err.message };
    }
  }

  ls(args) {
    try {
      const targetDir = args?.path ? this.assertSafePath(args.path) : this.workspaceRoot;
      if (!existsSync(targetDir)) return { success: false, error: "Directory not found: " + (args?.path || ".") };
      const entries = readdirSync(targetDir, { withFileTypes: true });
      const list = entries.map(e => (e.isDirectory() ? "[DIR]" : "[FILE]") + " " + e.name).join("\\n");
      return { success: true, output: list };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  find(args) {
    try {
      const baseDir = args.path ? this.assertSafePath(args.path) : this.workspaceRoot;
      if (!existsSync(baseDir)) return { success: false, error: "Directory not found: " + (args.path || ".") };
      const results = [];
      const escaped = args.pattern.replace(/[.+^$\\{}()|[\\]\\\\]/g, "\\\\$&").replace(/\\*/g, ".*").replace(/\\?/g, ".");
      const regex = new RegExp("^" + escaped + "$", "i");
      const visitedInodes = new Set();

      function walk(current, depth) {
        if (depth > 20) return;
        try {
          const stats = statSync(current);
          const inodeKey = stats.dev + ":" + stats.ino;
          if (visitedInodes.has(inodeKey)) return;
          visitedInodes.add(inodeKey);

          const items = readdirSync(current, { withFileTypes: true });
          for (const item of items) {
            if (item.name === "node_modules" || item.name === ".git") continue;
            const fullPath = join(current, item.name);
            if (regex.test(item.name)) results.push(fullPath);
            if (item.isDirectory() && !item.isSymbolicLink()) walk(fullPath, depth + 1);
          }
        } catch {}
      }

      walk(baseDir, 0);
      return { success: true, output: results.join("\\n") };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  grep(args) {
    try {
      const baseDir = args.path ? this.assertSafePath(args.path) : this.workspaceRoot;
      if (!existsSync(baseDir)) return { success: false, error: "Directory not found: " + (args.path || ".") };
      const matches = [];
      const visitedInodes = new Set();

      function searchDir(current, depth) {
        if (depth > 20) return;
        try {
          const stats = statSync(current);
          const inodeKey = stats.dev + ":" + stats.ino;
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
                const lines = text.split("\\n");
                lines.forEach((line, idx) => {
                  if (line.includes(args.query)) matches.push(fullPath + ":" + (idx + 1) + ": " + line.trim());
                });
              } catch {}
            }
          }
        } catch {}
      }

      searchDir(baseDir, 0);
      return { success: true, output: matches.slice(0, 100).join("\\n") };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }
}

export class CordisBridge {
  constructor(options) {
    this.options = options;
    this.tools = new OwnedTools(options.workspaceRoot);
    if (options.allowedTools) this.allowedTools = new Set(options.allowedTools);
  }

  isAvailable() { return true; }

  getToolDefinitions() {
    const list = [
      { name: "read", description: "Read file content from workspace" },
      { name: "write", description: "Write content to a file in workspace" },
      { name: "edit", description: "Replace text in a file in workspace" },
      { name: "bash", description: "Execute a command in workspace" },
      { name: "grep", description: "Search for query in workspace files" },
      { name: "find", description: "Find files matching pattern" },
      { name: "ls", description: "List files and directories" },
    ];
    if (this.allowedTools) return list.filter(t => this.allowedTools.has(t.name));
    return list;
  }

  invokeTool(toolName, args) {
    if (this.allowedTools && !this.allowedTools.has(toolName)) {
      return { success: false, error: "TOOL_DENIED: Tool \\"" + toolName + "\\" is not permitted for this agent context" };
    }
    switch (toolName) {
      case "read": return this.tools.read(args);
      case "write": return this.tools.write(args);
      case "edit": return this.tools.edit(args);
      case "bash": return this.tools.bash(args);
      case "grep": return this.tools.grep(args);
      case "find": return this.tools.find(args);
      case "ls": return this.tools.ls(args);
      default: return { success: false, error: "UNKNOWN_TOOL: Tool \\"" + toolName + "\\" is not provided by Cordis SDK bridge" };
    }
  }

  healthCheck() {
    return { ok: true, version: CORDIS_BRIDGE_VERSION, tools: this.getToolDefinitions().map(t => t.name) };
  }
}

export function createCordisBridge(workspaceRoot, options = {}) {
  return new CordisBridge({ workspaceRoot, ...options });
}
`;
}


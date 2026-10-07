import { existsSync, readFileSync } from "node:fs";

/**
 * Lightweight frontmatter parser for Metis plugin
 */
export interface ParsedFrontmatter<T = Record<string, any>> {
  data: T;
  content: string;
}

export function parseYamlFrontmatter<T = Record<string, any>>(text: string): ParsedFrontmatter<T> {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(text);
  if (!match) {
    return { data: {} as T, content: text };
  }

  const rawYaml = match[1];
  const content = match[2];
  const data: Record<string, any> = {};

  const lines = rawYaml.split("\n");
  let currentParent: { key: string; obj: Record<string, any> } | null = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    // Check for nested indentation (e.g. "  task: deny")
    if (line.startsWith("  ") && currentParent) {
      const colonIdx = trimmed.indexOf(":");
      if (colonIdx !== -1) {
        const key = trimmed.slice(0, colonIdx).trim();
        let val: any = trimmed.slice(colonIdx + 1).trim();
        if (val === "true") val = true;
        else if (val === "false") val = false;
        else if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
        currentParent.obj[key] = val;
      }
      continue;
    }

    currentParent = null;
    const colonIdx = trimmed.indexOf(":");
    if (colonIdx !== -1) {
      const key = trimmed.slice(0, colonIdx).trim();
      let val: any = trimmed.slice(colonIdx + 1).trim();
      if (!val) {
        // Parent object
        data[key] = {};
        currentParent = { key, obj: data[key] };
      } else {
        if (val === "true") val = true;
        else if (val === "false") val = false;
        else if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
        data[key] = val;
      }
    }
  }

  return { data: data as T, content };
}

export function readJsonSafe(filePath: string): any {
  try {
    if (!existsSync(filePath)) return null;
    return JSON.parse(readFileSync(filePath, "utf-8"));
  } catch {
    return null;
  }
}

export function readTextSafe(filePath: string): string | null {
  try {
    if (!existsSync(filePath)) return null;
    return readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }
}

export function extractModelFromJson(data: any): { model: string; thinking?: boolean } | null {
  if (!data || typeof data !== "object") return null;

  let model: string | undefined;
  let thinking: boolean | undefined;

  const directKeys = [
    "model",
    "active_model",
    "activeModel",
    "default_model",
    "defaultModel",
    "selected_model",
    "selectedModel",
    "current_model",
    "currentModel",
    "chat_model",
    "chatModel",
    "opencode.model",
    "codex.model",
    "deepseek.model",
    "chat.model",
    "llm.model",
  ];

  for (const k of directKeys) {
    if (typeof data[k] === "string" && data[k].trim()) {
      model = data[k].trim();
      break;
    }
  }

  if (!model) {
    const sections = ["chat", "llm", "opencode", "codex", "deepseek", "activeProfile"];
    for (const sec of sections) {
      if (data[sec] && typeof data[sec] === "object") {
        if (typeof data[sec].model === "string" && data[sec].model.trim()) {
          model = data[sec].model.trim();
          break;
        }
        if (typeof data[sec].name === "string" && data[sec].name.trim()) {
          model = data[sec].name.trim();
          break;
        }
        if (typeof data[sec].id === "string" && data[sec].id.trim()) {
          model = data[sec].id.trim();
          break;
        }
      }
    }
  }

  if (!model && data.model && typeof data.model === "object") {
    const id = data.model.id || data.model.name || data.model.model;
    if (typeof id === "string" && id.trim()) {
      model = id.trim();
    }
  }

  const thinkingKeys = [
    "thinking",
    "reasoning",
    "opencode.thinking",
    "codex.thinking",
    "deepseek.thinking",
    "chat.thinking",
    "llm.thinking",
  ];
  for (const k of thinkingKeys) {
    if (typeof data[k] === "boolean") {
      thinking = data[k];
      break;
    }
    if (data[k] === "true") {
      thinking = true;
      break;
    }
  }

  if (thinking === undefined) {
    for (const sec of ["chat", "llm", "deepseek", "codex", "opencode"]) {
      if (data[sec] && typeof data[sec] === "object") {
        if (typeof data[sec].thinking === "boolean") {
          thinking = data[sec].thinking;
          break;
        }
        if (typeof data[sec].reasoning === "boolean") {
          thinking = data[sec].reasoning;
          break;
        }
      }
    }
  }

  if (model) {
    return { model, thinking };
  }
  return null;
}

function stripTomlComment(line: string): string {
  let inDouble = false;
  let inSingle = false;
  let escaped = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\" && inDouble) {
      escaped = true;
      continue;
    }
    if (!inSingle && ch === '"') {
      inDouble = !inDouble;
      continue;
    }
    if (!inDouble && ch === "'") {
      inSingle = !inSingle;
      continue;
    }
    if (!inDouble && !inSingle && ch === "#") {
      return line.slice(0, i).trim();
    }
  }
  return line.trim();
}

export function extractModelFromToml(content: string): { model: string; thinking?: boolean } | null {
  const lines = content.split("\n");
  let currentSection = "";
  let foundModel: string | undefined;
  let foundThinking: boolean | undefined;

  for (const rawLine of lines) {
    const trimmed = stripTomlComment(rawLine);
    if (!trimmed) continue;

    const sectionMatch = /^\[([^\]]+)\]/.exec(trimmed);
    if (sectionMatch) {
      currentSection = sectionMatch[1].trim();
      continue;
    }

    const kvMatch = /^([a-zA-Z0-9_.-]+)\s*=\s*(.+)$/.exec(trimmed);
    if (kvMatch) {
      const key = kvMatch[1].trim();
      let rawVal = kvMatch[2].trim();

      let strVal: string | undefined;
      if ((rawVal.startsWith('"') && rawVal.endsWith('"')) || (rawVal.startsWith("'") && rawVal.endsWith("'"))) {
        strVal = rawVal.slice(1, -1);
      } else if (rawVal.startsWith("{") && rawVal.endsWith("}")) {
        const inlineMatch = /\b(?:model|name|id)\s*=\s*["']([^"']+)["']/.exec(rawVal);
        if (inlineMatch) {
          strVal = inlineMatch[1];
        }
      } else if (/^[a-zA-Z0-9_.:/-]+$/.test(rawVal) && rawVal !== "true" && rawVal !== "false") {
        strVal = rawVal;
      }

      const isModelKey =
        key === "model" ||
        key === "default_model" ||
        key === "active_model" ||
        key === "chat_model" ||
        key === "selected_model" ||
        key === "chat.model" ||
        key === "llm.model" ||
        key === "codex.model" ||
        key === "opencode.model" ||
        key === "deepseek.model" ||
        key.endsWith(".model");

      const isRelevantSection =
        currentSection === "chat" ||
        currentSection === "llm" ||
        currentSection === "model" ||
        currentSection === "codex" ||
        currentSection === "opencode" ||
        currentSection === "deepseek" ||
        currentSection.startsWith("profiles.") ||
        currentSection.startsWith("model.");

      if (isModelKey) {
        if (strVal && !foundModel) {
          foundModel = strVal;
        }
      } else if (isRelevantSection) {
        if ((key === "model" || key === "name" || key === "default" || key === "id") && strVal && !foundModel) {
          foundModel = strVal;
        }
      }

      if (key === "thinking" || key === "reasoning" || key.endsWith(".thinking") || key.endsWith(".reasoning")) {
        foundThinking = rawVal === "true" || rawVal === '"true"';
      } else if (isRelevantSection && (key === "thinking" || key === "reasoning")) {
        foundThinking = rawVal === "true" || rawVal === '"true"';
      }
    }
  }

  if (foundModel) {
    return { model: foundModel, thinking: foundThinking };
  }
  return null;
}


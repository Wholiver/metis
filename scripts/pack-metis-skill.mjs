#!/usr/bin/env node
/**
 * Pack Metis 插件版 (skill) as a standalone npm tarball for GitHub Releases.
 *
 * Bundles TypeScript with esbuild (Node refuses type-stripping under node_modules),
 * and ships contracts next to the package for runtime loading.
 *
 * Usage:
 *   node scripts/pack-metis-skill.mjs [--version 0.0.1] [--out-dir .]
 *
 * Produces: metis-skill-<version>.tgz
 */

import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const pluginSrc = join(repoRoot, "packages", "metis-plugin");
const contractsSrc = join(repoRoot, "contracts");
const frameworksSrc = join(repoRoot, "src", "core", "performance-frameworks.ts");

function parseArgs(argv) {
  const out = { version: "0.0.1", outDir: repoRoot };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--version" && argv[i + 1]) {
      out.version = argv[++i];
    } else if (arg.startsWith("--version=")) {
      out.version = arg.slice("--version=".length);
    } else if (arg === "--out-dir" && argv[i + 1]) {
      out.outDir = resolve(argv[++i]);
    } else if (arg.startsWith("--out-dir=")) {
      out.outDir = resolve(arg.slice("--out-dir=".length));
    } else if (arg === "--help" || arg === "-h") {
      console.log(`Usage: node scripts/pack-metis-skill.mjs [--version 0.0.1] [--out-dir .]`);
      process.exit(0);
    }
  }
  return out;
}

function rewriteProjectorImport(content) {
  return content.replace(
    /from\s+["']\.\.\/\.\.\/\.\.\/src\/core\/performance-frameworks\.ts["']/,
    'from "./performance-frameworks.ts"',
  );
}

function run(command, args, opts = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...opts,
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed:\n${result.stderr || result.stdout}`);
  }
  return result;
}

function main() {
  const { version, outDir } = parseArgs(process.argv.slice(2));

  for (const required of [pluginSrc, contractsSrc, frameworksSrc]) {
    if (!existsSync(required)) {
      throw new Error(`Missing required path: ${required}`);
    }
  }

  mkdirSync(outDir, { recursive: true });
  const stageRoot = mkdtempSync(join(tmpdir(), "metis-skill-pack-"));
  const stage = join(stageRoot, "package");
  const stageSrc = join(stage, "src");

  try {
    mkdirSync(stageSrc, { recursive: true });
    cpSync(join(pluginSrc, "src"), stageSrc, { recursive: true });
    cpSync(contractsSrc, join(stage, "contracts"), { recursive: true });
    cpSync(frameworksSrc, join(stageSrc, "performance-frameworks.ts"));

    const projectorPath = join(stageSrc, "projector.ts");
    const projector = readFileSync(projectorPath, "utf8");
    const rewritten = rewriteProjectorImport(projector);
    if (rewritten === projector) {
      throw new Error("Failed to rewrite performance-frameworks import in projector.ts");
    }
    writeFileSync(projectorPath, rewritten);

    mkdirSync(join(stage, "dist"), { recursive: true });
    run(
      "npx",
      [
        "--yes",
        "esbuild",
        join(stageSrc, "cli.ts"),
        "--bundle",
        "--platform=node",
        "--format=esm",
        "--packages=external",
        `--outfile=${join(stage, "dist", "cli.js")}`,
      ],
      { cwd: repoRoot },
    );

    // Drop TS sources from the published tarball — only dist + contracts ship.
    rmSync(stageSrc, { recursive: true, force: true });

    mkdirSync(join(stage, "bin"), { recursive: true });
    writeFileSync(
      join(stage, "bin", "metis-plugin.js"),
      `#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const { runCli } = await import(pathToFileURL(resolve(__dirname, "../dist/cli.js")).href);

runCli().then((code) => {
  process.exit(code);
}).catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
`,
    );

    const packageJson = {
      name: "metis-skill",
      version,
      description:
        "Metis 插件版 (skill) — explicit routing, bounded multi-agent delegation, and evidence-backed verification for Codex, OpenCode, and DeepSeek Harness.",
      license: "MIT",
      type: "module",
      bin: {
        "metis-plugin": "./bin/metis-plugin.js",
        "metis-skill": "./bin/metis-plugin.js",
      },
      files: ["bin/", "dist/", "contracts/", "README.md", "LICENSE"],
      engines: {
        node: ">=22.19.0",
      },
      keywords: [
        "metis",
        "metis-skill",
        "metis-plugin",
        "codex",
        "opencode",
        "deepseek",
        "agent-skill",
        "orchestration",
      ],
      repository: {
        type: "git",
        url: "git+https://github.com/Wholiver/metis.git",
        directory: "packages/metis-plugin",
      },
      homepage: "https://github.com/Wholiver/metis#readme",
      bugs: {
        url: "https://github.com/Wholiver/metis/issues",
      },
      publishConfig: {
        access: "public",
      },
    };
    writeFileSync(join(stage, "package.json"), `${JSON.stringify(packageJson, null, 2)}\n`);

    const skillReadme = `# Metis Skill (插件版) ${version}

Explicit-only Metis orchestration skill for Codex, OpenCode, and DeepSeek Harness.

## Install

\`\`\`bash
npm install -g https://github.com/Wholiver/metis/releases/download/skill-v${version}/metis-skill-${version}.tgz
metis-plugin
\`\`\`

Or install a specific host without the interactive installer:

\`\`\`bash
metis-plugin install codex
metis-plugin install opencode
metis-plugin install deepseek
\`\`\`

## Activate

\`\`\`bash
metis-plugin activate codex --target /absolute/project -- "your mission"
\`\`\`

See the main Metis README for Desktop / CLI installs.
`;
    writeFileSync(join(stage, "README.md"), skillReadme);
    cpSync(join(repoRoot, "LICENSE"), join(stage, "LICENSE"));

    const pack = run("npm", ["pack", "--pack-destination", outDir], { cwd: stage });
    const filename = `metis-skill-${version}.tgz`;
    const expected = join(outDir, filename);
    if (!existsSync(expected)) {
      throw new Error(`Expected tarball missing: ${expected}\nnpm pack output:\n${pack.stdout}`);
    }

    console.log(expected);
  } finally {
    rmSync(stageRoot, { recursive: true, force: true });
  }
}

main();

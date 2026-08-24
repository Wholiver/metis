import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const NUMBERED_CONFLICT_DIRECTORY = / \d+$/;
const STATIC_RELATIVE_IMPORT = /\b(?:import|export)\s+(?:[^"'`]*?\s+from\s+)?["'](\.[^"']+)["']/g;
const DYNAMIC_RELATIVE_IMPORT = /\bimport\s*\(\s*["'](\.[^"']+)["']\s*\)/g;

function relativePath(rootDir, target) {
  return path.relative(rootDir, target).split(path.sep).join('/');
}

function walkRuntime(rootDir) {
  const javascriptFiles = [];
  const conflictDirectories = [];
  const pending = [rootDir];

  while (pending.length > 0) {
    const directory = pending.pop();
    if (!directory || !fs.existsSync(directory)) continue;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules') continue;
        if (NUMBERED_CONFLICT_DIRECTORY.test(entry.name)) {
          conflictDirectories.push(target);
        }
        pending.push(target);
      } else if (entry.isFile() && entry.name.endsWith('.js')) {
        javascriptFiles.push(target);
      }
    }
  }

  return { javascriptFiles, conflictDirectories };
}

function resolveRelativeImport(sourceFile, specifier) {
  const cleanSpecifier = specifier.split(/[?#]/, 1)[0];
  const base = path.resolve(path.dirname(sourceFile), cleanSpecifier);
  const candidates = path.extname(base)
    ? [base]
    : [base, `${base}.js`, path.join(base, 'index.js')];
  return candidates.find((candidate) => fs.existsSync(candidate));
}

function relativeImports(source) {
  const imports = [];
  for (const pattern of [STATIC_RELATIVE_IMPORT, DYNAMIC_RELATIVE_IMPORT]) {
    pattern.lastIndex = 0;
    for (const match of source.matchAll(pattern)) imports.push(match[1]);
  }
  return imports;
}

export function validateRuntimeTree(runtimeDir) {
  const rootDir = path.resolve(runtimeDir);
  if (!fs.existsSync(rootDir) || !fs.statSync(rootDir).isDirectory()) {
    return [{ kind: 'missing-runtime', source: '', target: rootDir }];
  }

  const issues = [];
  const { javascriptFiles, conflictDirectories } = walkRuntime(rootDir);
  for (const directory of conflictDirectories) {
    issues.push({
      kind: 'conflict-directory',
      source: '',
      target: relativePath(rootDir, directory),
    });
  }

  for (const sourceFile of javascriptFiles) {
    const source = fs.readFileSync(sourceFile, 'utf8');
    for (const specifier of relativeImports(source)) {
      if (resolveRelativeImport(sourceFile, specifier)) continue;
      const target = path.resolve(path.dirname(sourceFile), specifier.split(/[?#]/, 1)[0]);
      issues.push({
        kind: 'missing-import',
        source: relativePath(rootDir, sourceFile),
        target: relativePath(rootDir, target),
        specifier,
      });
    }
  }

  return issues;
}

function formatIssue(issue) {
  if (issue.kind === 'conflict-directory') {
    return `iCloud-style conflict directory: ${issue.target}`;
  }
  if (issue.kind === 'missing-import') {
    return `${issue.source} imports missing ${issue.target}`;
  }
  return `Runtime directory missing: ${issue.target}`;
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  const runtimeDir = path.resolve(process.argv[2] || 'dist');
  const issues = validateRuntimeTree(runtimeDir);
  if (issues.length > 0) {
    console.error(`Runtime integrity check failed: ${issues.length} issue(s) in ${runtimeDir}`);
    for (const issue of issues.slice(0, 50)) console.error(`- ${formatIssue(issue)}`);
    if (issues.length > 50) console.error(`- … ${issues.length - 50} more`);
    process.exitCode = 1;
  } else {
    console.log(`Runtime integrity check passed: ${runtimeDir}`);
  }
}

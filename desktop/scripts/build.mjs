import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const desktopDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDir = path.join(desktopDir, "dist");

await rm(outputDir, { recursive: true, force: true });
await mkdir(outputDir, { recursive: true });
await cp(path.join(desktopDir, "main.cjs"), path.join(outputDir, "main.cjs"));
await cp(path.join(desktopDir, "preload.cjs"), path.join(outputDir, "preload.cjs"));
await cp(path.join(desktopDir, "renderer"), path.join(outputDir, "renderer"), { recursive: true });

const packageJson = JSON.parse(await readFile(path.join(desktopDir, "package.json"), "utf8"));
packageJson.main = "main.cjs";
delete packageJson.devDependencies;
packageJson.scripts = { start: "electron ." };
await writeFile(path.join(outputDir, "package.json"), `${JSON.stringify(packageJson, null, 2)}\n`);

console.log(`Built Electron desktop artifact: ${outputDir}`);

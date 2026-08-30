import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const desktopDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDir = path.join(desktopDir, "dist");

await rm(outputDir, { recursive: true, force: true });
await mkdir(outputDir, { recursive: true });
await mkdir(path.join(outputDir, "src"), { recursive: true });
await cp(path.join(desktopDir, "main.cjs"), path.join(outputDir, "main.cjs"));
await cp(path.join(desktopDir, "main-menu.cjs"), path.join(outputDir, "main-menu.cjs"));
await cp(path.join(desktopDir, "provider-config.cjs"), path.join(outputDir, "provider-config.cjs"));
await cp(path.join(desktopDir, "workspace-create.cjs"), path.join(outputDir, "workspace-create.cjs"));
await cp(path.join(desktopDir, "runtime-integrity.cjs"), path.join(outputDir, "runtime-integrity.cjs"));
await cp(path.join(desktopDir, "session-token-totals.cjs"), path.join(outputDir, "session-token-totals.cjs"));
await cp(path.join(desktopDir, "server-connection.cjs"), path.join(outputDir, "server-connection.cjs"));
await cp(path.join(desktopDir, "preload.cjs"), path.join(outputDir, "preload.cjs"));
await cp(path.join(desktopDir, "i18n.cjs"), path.join(outputDir, "i18n.cjs"));
await cp(path.join(desktopDir, "i18n-source.cjs"), path.join(outputDir, "i18n-source.cjs"));
await cp(path.join(desktopDir, "src", "i18n-catalogs.js"), path.join(outputDir, "src", "i18n-catalogs.js"));
await cp(path.join(desktopDir, "src", "i18n-catalogs.cjs"), path.join(outputDir, "src", "i18n-catalogs.cjs"));
await cp(path.join(desktopDir, "public"), path.join(outputDir, "public"), { recursive: true });
await cp(path.join(desktopDir, "assets"), path.join(outputDir, "assets"), { recursive: true });
await cp(path.join(desktopDir, "renderer"), path.join(outputDir, "renderer"), { recursive: true });

const packageJson = JSON.parse(await readFile(path.join(desktopDir, "package.json"), "utf8"));
packageJson.main = "main.cjs";
delete packageJson.devDependencies;
packageJson.scripts = { start: "electron ." };
await writeFile(path.join(outputDir, "package.json"), `${JSON.stringify(packageJson, null, 2)}\n`);

console.log(`Built Electron desktop artifact: ${outputDir}`);

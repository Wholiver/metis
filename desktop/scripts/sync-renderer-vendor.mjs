import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const desktopDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const vendorDir = path.join(desktopDir, "renderer", "vendor");

await mkdir(vendorDir, { recursive: true });
await Promise.all([
	copyFile(path.join(desktopDir, "node_modules", "marked", "lib", "marked.umd.js"), path.join(vendorDir, "marked.js")),
	copyFile(path.join(desktopDir, "node_modules", "dompurify", "dist", "purify.min.js"), path.join(vendorDir, "purify.js")),
]);

console.log(`Prepared Desktop renderer dependencies: ${vendorDir}`);

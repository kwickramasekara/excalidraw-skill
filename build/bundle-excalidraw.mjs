#!/usr/bin/env node

/**
 * Bundles @excalidraw/excalidraw into a single Node-compatible ESM file
 * so convert.mjs can import it without browser/CJS/ESM issues.
 *
 * Output: dist/excalidraw.mjs
 *
 * Usage:
 *   node build/bundle-excalidraw.mjs
 */

import { execSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const distDir = join(ROOT, "dist");
const outFile = join(distDir, "excalidraw.mjs");

if (!existsSync(distDir)) {
  mkdirSync(distDir, { recursive: true });
}

// Verify @excalidraw/excalidraw is installed locally
const excalidrawPkg = join(ROOT, "node_modules", "@excalidraw", "excalidraw");
if (!existsSync(excalidrawPkg)) {
  console.error(
    "Error: @excalidraw/excalidraw not found in node_modules.\n" +
      "Run 'npm install' first.",
  );
  process.exit(1);
}

// Write a tiny entry file that re-exports just what we need
const entryCode = `import { convertToExcalidrawElements } from "@excalidraw/excalidraw";\nexport { convertToExcalidrawElements };\n`;
const entryFile = join(distDir, "_entry.mjs");
writeFileSync(entryFile, entryCode);

// Bundle with esbuild (use local install)
const esbuild = join(ROOT, "node_modules", ".bin", "esbuild");
const cmd = [
  `"${esbuild}"`,
  `"${entryFile}"`,
  "--bundle",
  "--format=esm",
  "--platform=node",
  `--outfile="${outFile}"`,
  "--tree-shaking=true",
  '--define:process.env.NODE_ENV=\\"production\\"',
  "--log-level=warning",
].join(" ");

console.log("Bundling @excalidraw/excalidraw...");

try {
  execSync(cmd, {
    encoding: "utf-8",
    stdio: "inherit",
    cwd: ROOT,
  });
} catch {
  console.error("esbuild failed.");
  process.exit(1);
}

// Clean up temp entry
try {
  unlinkSync(entryFile);
} catch {}

console.log(`Bundle written to ${outFile}`);

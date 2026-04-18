#!/usr/bin/env node

/**
 * Build script for excalidraw-preview single executable.
 *
 * Uses Node.js v25.5+ --build-sea which handles blob generation + injection
 * in a single step. No postject needed.
 *
 * Pipeline:
 *   1. esbuild bundles src/preview.js + all JS deps into one file
 *   2. Generate SEA entry wrapper (extracts native addon + fonts at runtime)
 *   3. Download official Node.js binary (Homebrew build lacks SEA fuse)
 *   4. node --build-sea generates blob, injects into binary, outputs final exe
 *   5. codesign on macOS
 *
 * Output: dist/preview
 *
 * Usage:
 *   node build/build-preview.mjs
 */

import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";

const __dirname = path.dirname(new URL(import.meta.url).pathname);
const ROOT = path.join(__dirname, "..");
const BUILD_DIR = path.join(ROOT, ".sea-build");
const OUTPUT_BIN = path.join(ROOT, "dist", "preview");

const NODE_VERSION = process.version;
const PLATFORM = process.platform;
const ARCH = process.arch;

// ── Paths ────────────────────────────────────────────────────────────
const NATIVE_ADDON = path.join(
  ROOT,
  `node_modules/@resvg/resvg-js-${PLATFORM}-${ARCH}/resvgjs.${PLATFORM}-${ARCH}.node`
);

const FONT_DIR = path.join(
  ROOT,
  "node_modules/@excalidraw/utils/dist/prod/assets"
);

// ── Helpers ──────────────────────────────────────────────────────────
function run(cmd, opts = {}) {
  console.log(`  $ ${cmd}`);
  return execSync(cmd, { stdio: "inherit", cwd: ROOT, ...opts });
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

// ── Step 1: Bundle JS with esbuild ──────────────────────────────────
function bundleJS() {
  console.log("\n[1/5] Bundling JS with esbuild...");

  // Patch jsdom to inline its CSS file (it uses readFileSync at runtime
  // which won't work in SEA since __dirname changes)
  const jsdomCSSHelper = path.join(
    ROOT,
    "node_modules/jsdom/lib/jsdom/living/css/helpers/computed-style.js"
  );
  const jsdomCSSHelperOriginal = fs.readFileSync(jsdomCSSHelper, "utf-8");

  const cssFile = path.join(
    ROOT,
    "node_modules/jsdom/lib/jsdom/browser/default-stylesheet.css"
  );
  const cssContent = fs.readFileSync(cssFile, "utf-8");
  const escaped = JSON.stringify(cssContent);

  const patched = jsdomCSSHelperOriginal.replace(
    /const defaultStyleSheet = fs\.readFileSync\([^)]+\),\s*\{[^}]+\}\s*\);/,
    `const defaultStyleSheet = ${escaped};`
  );
  fs.writeFileSync(jsdomCSSHelper, patched);

  // Patch css-tree files that use createRequire(import.meta.url) to load JSON.
  const cssTreePatches = [];

  const cssTreeDataPatch = path.join(ROOT, "node_modules/css-tree/lib/data-patch.js");
  const cssTreeDataPatchOriginal = fs.readFileSync(cssTreeDataPatch, "utf-8");
  fs.writeFileSync(cssTreeDataPatch,
    `import patch from '../data/patch.json';\nexport default patch;\n`
  );
  cssTreePatches.push([cssTreeDataPatch, cssTreeDataPatchOriginal]);

  const cssTreeData = path.join(ROOT, "node_modules/css-tree/lib/data.js");
  const cssTreeDataOriginal = fs.readFileSync(cssTreeData, "utf-8");
  fs.writeFileSync(cssTreeData,
    cssTreeDataOriginal
      .replace(/import \{ createRequire \} from 'module';\n/, '')
      .replace(/const require = createRequire\(import\.meta\.url\);\n/, '')
      .replace(/const mdnAtrules = require\('mdn-data\/css\/at-rules\.json'\);/, "import mdnAtrules from 'mdn-data/css/at-rules.json';")
      .replace(/const mdnProperties = require\('mdn-data\/css\/properties\.json'\);/, "import mdnProperties from 'mdn-data/css/properties.json';")
      .replace(/const mdnSyntaxes = require\('mdn-data\/css\/syntaxes\.json'\);/, "import mdnSyntaxes from 'mdn-data/css/syntaxes.json';")
  );
  cssTreePatches.push([cssTreeData, cssTreeDataOriginal]);

  const cssTreeVersion = path.join(ROOT, "node_modules/css-tree/lib/version.js");
  const cssTreeVersionOriginal = fs.readFileSync(cssTreeVersion, "utf-8");
  fs.writeFileSync(cssTreeVersion,
    `import pkg from '../package.json';\nexport const version = pkg.version;\n`
  );
  cssTreePatches.push([cssTreeVersion, cssTreeVersionOriginal]);

  // Patch jsdom's XMLHttpRequest to avoid require.resolve
  const xhrImpl = path.join(ROOT, "node_modules/jsdom/lib/jsdom/living/xhr/XMLHttpRequest-impl.js");
  const xhrImplOriginal = fs.readFileSync(xhrImpl, "utf-8");
  fs.writeFileSync(xhrImpl, xhrImplOriginal.replace(
    'const syncWorkerFile = require.resolve("./xhr-sync-worker.js");',
    'const syncWorkerFile = __dirname + "/xhr-sync-worker.js";'
  ));
  cssTreePatches.push([xhrImpl, xhrImplOriginal]);

  const outfile = path.join(BUILD_DIR, "bundle.cjs");

  try {
    run(
      [
        `"${path.join(ROOT, "node_modules/.bin/esbuild")}"`,
        `"${path.join(ROOT, "src/preview.js")}"`,
        "--bundle",
        "--platform=node",
        "--format=cjs",
        "--target=node20",
        "--external:*.node",
        "--external:@resvg/resvg-js-*",
        `--outfile="${outfile}"`,
      ].join(" ")
    );
  } finally {
    // Restore patched files
    fs.writeFileSync(jsdomCSSHelper, jsdomCSSHelperOriginal);
    for (const [filePath, original] of cssTreePatches) {
      fs.writeFileSync(filePath, original);
    }
  }

  return outfile;
}

// ── Step 2: Create SEA entry wrapper ────────────────────────────────
function createSEAEntry() {
  console.log("\n[2/5] Creating SEA entry wrapper...");

  const fontFiles = fs
    .readdirSync(FONT_DIR)
    .filter((f) => f.endsWith(".ttf"));

  const fontExtractLines = fontFiles
    .map((f) => `  extractAsset("${f}", path.join(cacheDir, "${f}"));`)
    .join("\n");

  const fontPathLines = fontFiles
    .map((f) => `    path.join(cacheDir, "${f}")`)
    .join(",\n");

  let bundleCode = fs.readFileSync(
    path.join(BUILD_DIR, "bundle.cjs"),
    "utf-8"
  );
  bundleCode = bundleCode.replace(/^#!.*\n/, "");

  const entryCode = `\
"use strict";
const sea = require("node:sea");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

// ── Asset extraction ─────────────────────────────────────────────────
const cacheDir = path.join(os.tmpdir(), "excalidraw-preview-sea");
fs.mkdirSync(cacheDir, { recursive: true });

function extractAsset(name, dest) {
  if (fs.existsSync(dest)) return;
  const buf = sea.getRawAsset(name);
  fs.writeFileSync(dest, new Uint8Array(buf));
}

// ── Extract native addon ─────────────────────────────────────────────
const addonPath = path.join(cacheDir, "resvgjs.node");
extractAsset("resvgjs.node", addonPath);

// Load native addon via dlopen
const addonModule = { exports: {} };
process.dlopen(addonModule, addonPath);

// Wrap to match @resvg/resvg-js/index.js API
const _Resvg = addonModule.exports.Resvg;
global.__seaResvg = {
  Resvg: class Resvg extends _Resvg {
    constructor(svg, options) {
      super(svg, JSON.stringify(options));
    }
  },
  render: addonModule.exports.render,
  renderAsync: addonModule.exports.renderAsync,
};

// ── Extract fonts ────────────────────────────────────────────────────
${fontExtractLines}

global.__seaFontPaths = [
${fontPathLines}
];

// ── Run the bundled app (inlined) ────────────────────────────────────
`;

  const combinedPath = path.join(BUILD_DIR, "sea-main.cjs");
  fs.writeFileSync(
    combinedPath,
    entryCode + "\n;(function(){" + bundleCode + "\n})();\n"
  );

  const combinedSize = fs.statSync(combinedPath).size;
  console.log(
    `  Combined entry + bundle: ${(combinedSize / 1024 / 1024).toFixed(1)} MB`
  );

  return combinedPath;
}

// ── Step 3: Download official Node.js binary ────────────────────────
async function downloadNodeBinary() {
  console.log("\n[3/5] Preparing Node.js binary with SEA fuse...");

  const cachedNode = path.join(BUILD_DIR, "node-official");

  if (fs.existsSync(cachedNode)) {
    const content = fs.readFileSync(cachedNode);
    if (
      content.includes("NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2")
    ) {
      console.log("  Using cached official Node.js binary");
      return cachedNode;
    }
  }

  const tarName = `node-${NODE_VERSION}-${PLATFORM}-${ARCH}`;
  const url = `https://nodejs.org/dist/${NODE_VERSION}/${tarName}.tar.gz`;
  console.log(`  Downloading ${url} ...`);

  const resp = await fetch(url);
  if (!resp.ok) {
    throw new Error(
      `Failed to download Node.js binary: ${resp.status} ${resp.statusText}`
    );
  }

  const tarPath = path.join(BUILD_DIR, "node.tar.gz");
  const fileStream = fs.createWriteStream(tarPath);
  await pipeline(resp.body, fileStream);

  const tarDir = path.join(BUILD_DIR, "node-download");
  ensureDir(tarDir);
  run(
    `tar -xzf "${tarPath}" -C "${tarDir}" --strip-components=2 "${tarName}/bin/node"`
  );

  const extractedNode = path.join(tarDir, "node");
  fs.copyFileSync(extractedNode, cachedNode);
  fs.chmodSync(cachedNode, 0o755);

  // Cleanup
  fs.rmSync(tarDir, { recursive: true, force: true });
  fs.rmSync(tarPath, { force: true });

  console.log("  Downloaded and cached official Node.js binary");
  return cachedNode;
}

// ── Step 4: Generate SEA config and build ───────────────────────────
function buildSEA(entryPath, nodeBinary) {
  console.log("\n[4/5] Building single executable...");

  const fontFiles = fs
    .readdirSync(FONT_DIR)
    .filter((f) => f.endsWith(".ttf"));

  const assets = {
    "resvgjs.node": NATIVE_ADDON,
  };
  for (const f of fontFiles) {
    assets[f] = path.join(FONT_DIR, f);
  }

  const config = {
    main: entryPath,
    output: OUTPUT_BIN,
    executable: nodeBinary,
    disableExperimentalSEAWarning: true,
    useSnapshot: false,
    useCodeCache: false,
    assets,
  };

  const configPath = path.join(BUILD_DIR, "sea-config.json");
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

  run(`"${nodeBinary}" --build-sea="${configPath}"`);
}

// ── Step 5: Code-sign ───────────────────────────────────────────────
function codesign() {
  if (PLATFORM !== "darwin") return;
  console.log("\n[5/5] Code-signing...");
  run(`codesign --sign - "${OUTPUT_BIN}"`);
}

// ── Main ─────────────────────────────────────────────────────────────
async function main() {
  console.log("Building excalidraw-preview single executable...");
  console.log(`  Node: ${NODE_VERSION} (${PLATFORM}-${ARCH})`);
  console.log(`  Output: ${OUTPUT_BIN}`);

  if (!fs.existsSync(NATIVE_ADDON)) {
    console.error(`Error: Native addon not found at ${NATIVE_ADDON}`);
    console.error("Run 'npm install' first.");
    process.exit(1);
  }

  ensureDir(BUILD_DIR);
  ensureDir(path.dirname(OUTPUT_BIN));

  bundleJS();
  const entryPath = createSEAEntry();
  const nodeBinary = await downloadNodeBinary();
  buildSEA(entryPath, nodeBinary);
  codesign();

  const finalSize = fs.statSync(OUTPUT_BIN).size;
  console.log(
    `\nDone! Built: ${OUTPUT_BIN} (${(finalSize / 1024 / 1024).toFixed(1)} MB)`
  );
  console.log(`\nUsage: ./dist/preview <input.excalidraw> [output.png]`);
}

main().catch((err) => {
  console.error("\nBuild failed:", err.message || err);
  process.exit(1);
});

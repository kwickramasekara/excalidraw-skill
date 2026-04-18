#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

// ── DOM shims required by @excalidraw/utils ──────────────────────────
const { JSDOM } = require("jsdom");

const dom = new JSDOM("<!DOCTYPE html><html><body></body></html>", {
  url: "https://localhost",
  pretendToBeVisual: true,
});

// Patch globals before loading excalidraw
const globalShims = [
  "window",
  "document",
  "navigator",
  "DOMParser",
  "XMLSerializer",
  "Element",
  "SVGElement",
  "HTMLElement",
  "Node",
  "Text",
  "DocumentFragment",
  "MutationObserver",
];

for (const key of globalShims) {
  if (!global[key]) {
    global[key] = dom.window[key];
  }
}

// Additional shims excalidraw may reference
global.devicePixelRatio = 1;
global.window.devicePixelRatio = 1;
global.FontFace = class FontFace {
  constructor(family, source) {
    this.family = family;
    this.source = source;
    this.status = "loaded";
  }
  load() { return Promise.resolve(this); }
};
global.window.FontFace = global.FontFace;
if (!global.document.fonts) {
  global.document.fonts = {
    add() {},
    check() { return true; },
    entries() { return [][Symbol.iterator](); },
    forEach() {},
    has() { return false; },
    keys() { return [][Symbol.iterator](); },
    values() { return [][Symbol.iterator](); },
    ready: Promise.resolve(),
    addEventListener() {},
    removeEventListener() {},
  };
}
global.window.DOMMatrix = class DOMMatrix {
  constructor() {
    this.a = 1; this.b = 0; this.c = 0; this.d = 1; this.e = 0; this.f = 0;
  }
};
global.window.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};
global.window.requestAnimationFrame = (cb) => setTimeout(cb, 0);
global.window.cancelAnimationFrame = (id) => clearTimeout(id);
global.window.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {} });
global.window.getComputedStyle = () => ({ getPropertyValue() { return ""; } });
global.window.EXCALIDRAW_EXPORT_SOURCE = "excalidraw-preview";
if (!global.crypto) {
  try { global.crypto = require("crypto"); } catch {}
}

if (!global.URL.createObjectURL) {
  global.URL.createObjectURL = () => "";
  global.URL.revokeObjectURL = () => {};
}

// ── Load excalidraw utils after shims ────────────────────────────────
// Suppress noisy font-face warnings from excalidraw internals
const _consoleWarn = console.warn;
const _consoleLog = console.log;
const _consoleError = console.error;
console.warn = (...args) => {
  if (typeof args[0] === "string" && args[0].includes("font-face")) return;
  _consoleWarn.apply(console, args);
};
console.log = (...args) => {
  if (typeof args[0] === "string" && args[0].includes("font-face")) return;
  _consoleLog.apply(console, args);
};
console.error = (...args) => {
  if (typeof args[0] === "string" && args[0].includes("font-face")) return;
  _consoleError.apply(console, args);
};
const { exportToSvg } = require("@excalidraw/utils");

// ── Resvg loading (patchable for SEA) ────────────────────────────────
// When running as SEA, global.__seaResvg is set by the entry wrapper.
// When running normally, we require it from node_modules.
const { Resvg } = global.__seaResvg || require("@resvg/resvg-js");

// ── Font loading (patchable for SEA) ─────────────────────────────────
// When running as SEA, global.__seaFontPaths is set by the entry wrapper.
function getBundledFontPaths() {
  if (global.__seaFontPaths) return global.__seaFontPaths;

  const assetsDir = path.join(
    __dirname,
    "node_modules/@excalidraw/utils/dist/prod/assets"
  );

  if (!fs.existsSync(assetsDir)) return [];

  return fs
    .readdirSync(assetsDir)
    .filter((f) => f.endsWith(".ttf"))
    .map((f) => path.join(assetsDir, f));
}

// ── Main ─────────────────────────────────────────────────────────────
async function convert(inputPath, outputPath) {
  if (!fs.existsSync(inputPath)) {
    console.error(`Error: File not found: ${inputPath}`);
    process.exit(1);
  }

  const raw = fs.readFileSync(inputPath, "utf-8");
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    console.error("Error: Invalid JSON in .excalidraw file");
    process.exit(1);
  }

  const elements = data.elements || [];
  const appState = data.appState || {};
  const files = data.files || {};

  if (elements.length === 0) {
    console.error("Error: No elements found in the file");
    process.exit(1);
  }

  console.log(`Converting ${path.basename(inputPath)} (${elements.length} elements)...`);

  // Export to SVG
  const svg = await exportToSvg({
    elements,
    appState: {
      exportWithDarkMode: appState.exportWithDarkMode ?? false,
      exportBackground: appState.exportBackground ?? true,
      viewBackgroundColor: appState.viewBackgroundColor || "#ffffff",
    },
    files,
    exportPadding: 20,
  });

  let svgString = svg.outerHTML || new dom.window.XMLSerializer().serializeToString(svg);

  // Render SVG to PNG using resvg (fonts loaded natively via fontFiles)
  const fontFiles = getBundledFontPaths();
  const resvg = new Resvg(svgString, {
    fitTo: { mode: "width", value: 2048 },
    font: {
      fontFiles,
      loadSystemFonts: false,
      defaultFontFamily: "Excalifont",
    },
    dpi: 144,
  });

  const pngData = resvg.render();
  const pngBuffer = pngData.asPng();

  fs.writeFileSync(outputPath, pngBuffer);
  console.log(`Saved: ${outputPath} (${Math.round(pngBuffer.length / 1024)} KB)`);
}

// ── CLI ──────────────────────────────────────────────────────────────
const args = process.argv.slice(2);

if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
  console.log(`
Usage: preview <input.excalidraw> [output.png]

Converts an Excalidraw file to a PNG image preview.

Arguments:
  input     Path to .excalidraw file
  output    Output PNG path (default: <input-name>.png)

Options:
  -h, --help    Show this help message
`);
  process.exit(0);
}

const input = path.resolve(args[0]);
const output = args[1]
  ? path.resolve(args[1])
  : input.replace(/\.excalidraw$/, ".png");

convert(input, output).catch((err) => {
  console.error("Conversion failed:", err.message || err);
  process.exit(1);
});

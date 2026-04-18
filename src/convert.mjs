#!/usr/bin/env node

/**
 * Converts an ExcalidrawElementSkeleton .mjs file into a .excalidraw file.
 *
 * The input .mjs must `export default` an array of skeleton objects.
 *
 * Prerequisites: run `npm run build:lib` once to create
 * the bundled excalidraw module (dist/excalidraw.mjs).
 *
 * Usage:
 *   node convert.mjs <diagram.mjs> [output.excalidraw]
 */

import { existsSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------------------
// Browser global stubs — the bundled excalidraw code references these during
// module init even though convertToExcalidrawElements doesn't need them at
// call time.  Each was verified necessary by removing it and confirming a
// crash on import.
// ---------------------------------------------------------------------------

const noop = () => {};

if (typeof globalThis.window === "undefined") {
  globalThis.window = globalThis;
  globalThis.window.location = { origin: "https://excalidraw.com", href: "" };
}

if (typeof globalThis.document === "undefined") {
  const stubEl = () => ({
    getContext: () => ({ measureText: () => ({ width: 0 }), font: "" }),
    setAttribute: noop,
    setAttributeNS: noop,
    style: {},
  });
  globalThis.document = {
    createElement: stubEl,
    createElementNS: stubEl,
    documentElement: { style: {} },
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: noop,
    removeEventListener: noop,
    createTextNode: () => ({}),
    body: { appendChild: noop, removeChild: noop },
    head: { appendChild: noop },
  };
}

if (typeof globalThis.navigator === "undefined")
  globalThis.navigator = {
    userAgent: "node",
    platform: "node",
    language: "en",
    clipboard: {},
  };
if (typeof globalThis.Element === "undefined")
  globalThis.Element = class {
    get prototype() {
      return {};
    }
  };
if (typeof globalThis.HTMLElement === "undefined")
  globalThis.HTMLElement = class {};
if (typeof globalThis.SVGElement === "undefined")
  globalThis.SVGElement = class {};
if (typeof globalThis.HTMLCanvasElement === "undefined")
  globalThis.HTMLCanvasElement = class {};
if (typeof globalThis.CanvasRenderingContext2D === "undefined")
  globalThis.CanvasRenderingContext2D = class {};
if (typeof globalThis.FontFace === "undefined")
  globalThis.FontFace = class {
    load() {
      return Promise.resolve(this);
    }
  };
if (typeof globalThis.Image === "undefined") globalThis.Image = class {};
if (typeof globalThis.DOMMatrix === "undefined")
  globalThis.DOMMatrix = class {
    constructor() {
      this.a = 1;
      this.b = 0;
      this.c = 0;
      this.d = 1;
      this.e = 0;
      this.f = 0;
    }
  };
if (typeof globalThis.DOMParser === "undefined")
  globalThis.DOMParser = class {
    parseFromString() {
      return { querySelector: () => null, querySelectorAll: () => [] };
    }
  };
if (typeof globalThis.ResizeObserver === "undefined")
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
if (typeof globalThis.requestAnimationFrame === "undefined")
  globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 0);
if (typeof globalThis.cancelAnimationFrame === "undefined")
  globalThis.cancelAnimationFrame = clearTimeout;
if (typeof globalThis.devicePixelRatio === "undefined")
  globalThis.devicePixelRatio = 1;
if (typeof globalThis.fetch === "undefined")
  globalThis.fetch = () =>
    Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
if (typeof globalThis.Worker === "undefined")
  globalThis.Worker = class {
    postMessage() {}
    terminate() {}
    addEventListener() {}
  };
if (typeof globalThis.Blob === "undefined") globalThis.Blob = class {};
if (typeof globalThis.FileReader === "undefined")
  globalThis.FileReader = class {
    readAsDataURL() {}
    addEventListener() {}
  };
if (typeof globalThis.ClipboardItem === "undefined")
  globalThis.ClipboardItem = class {};
if (typeof globalThis.OffscreenCanvas === "undefined")
  globalThis.OffscreenCanvas = class {
    getContext() {
      return { measureText: () => ({ width: 0 }), font: "" };
    }
  };
if (typeof globalThis.getComputedStyle === "undefined")
  globalThis.getComputedStyle = () => ({});
if (typeof globalThis.matchMedia === "undefined")
  globalThis.matchMedia = () => ({
    matches: false,
    addEventListener: noop,
    removeEventListener: noop,
  });

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const __dirname = dirname(fileURLToPath(import.meta.url));
const bundlePath = join(__dirname, "excalidraw.mjs");

async function main() {
  const args = process.argv.slice(2);
  const inputArg = args[0];
  const outputArg = args[1];

  if (!inputArg) {
    console.error("Usage: node convert.mjs <diagram.mjs> [output.excalidraw]");
    process.exit(1);
  }

  if (!existsSync(bundlePath)) {
    console.error(
      `Error: bundle not found at ${bundlePath}\n` +
        "Run the build step first:  npm run build:lib",
    );
    process.exit(1);
  }

  // Import the pre-built bundle
  const { convertToExcalidrawElements } = await import(bundlePath);

  // Import the user's skeleton module
  const inputPath = resolve(process.cwd(), inputArg);
  const mod = await import(inputPath);
  const skeletons = mod.default;

  if (!Array.isArray(skeletons)) {
    console.error(
      "Error: the input module must `export default` an array of skeleton elements.",
    );
    process.exit(1);
  }

  // Pre-process: for arrow/line skeletons without explicit `points`, derive
  // points from width/height so convertToExcalidrawElements doesn't generate
  // default points that ignore the intended geometry.
  for (const sk of skeletons) {
    if ((sk.type === "arrow" || sk.type === "line") && !sk.points) {
      const w = sk.width ?? 0;
      const h = sk.height ?? 0;
      sk.points = [
        [0, 0],
        [w, h],
      ];
    }
  }

  const elements = convertToExcalidrawElements(skeletons);

  const excalidrawFile = {
    type: "excalidraw",
    version: 2,
    source: "https://excalidraw.com",
    elements,
    appState: { viewBackgroundColor: "#ffffff", gridSize: null },
    files: {},
  };

  const json = JSON.stringify(excalidrawFile, null, 2);

  if (outputArg) {
    writeFileSync(outputArg, json, "utf-8");
    console.log(`Wrote ${elements.length} elements to ${outputArg}`);
  } else {
    process.stdout.write(json);
  }
}

main().catch((err) => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});

# excalidraw-skill

An agent skill for generating [Excalidraw](https://excalidraw.com) diagrams from natural language descriptions. The agent writes element skeleton definitions, converts them to `.excalidraw` files, and renders PNG previews for visual verification — all without a browser.

## How It Works

```
Agent writes diagram.mjs
  (ExcalidrawElementSkeleton array)
         │
         ▼
node dist/convert.mjs diagram.mjs output.excalidraw
  └── Converts skeletons → valid .excalidraw JSON
         │
         ▼
dist/preview output.excalidraw preview.png
  └── Renders .excalidraw → PNG (via Resvg/Rust)
         │
         ▼
Agent inspects PNG → iterates if needed → shows result to user
```

## Requirements

- **Node.js >= 25.5.0** (required for the built-in `--build-sea` Single Executable Application feature)
- npm

## Installation

```bash
npm install
```

## Building

Build everything (Excalidraw library bundle + preview binary):

```bash
npm run build
```

Or build individually:

```bash
npm run build:lib      # produces dist/excalidraw.mjs
npm run build:preview  # produces dist/preview (downloads official Node binary, takes a few minutes)
```

> `build:preview` downloads an official Node.js binary from `nodejs.org/dist` and caches it in `.sea-build/node-official`. Homebrew-installed Node binaries lack the SEA fuse required for this step.

## Deploying to opencode

```bash
npm run deploy
```

This copies the built artifacts to the opencode skills directory (default: `~/.config/opencode/skills/excalidraw/`). You will be prompted to confirm or change the target path.

Files deployed:

- `SKILL.md` — skill definition read by the opencode agent
- `src/convert.mjs` — skeleton-to-`.excalidraw` converter
- `dist/excalidraw.mjs` — pre-bundled Excalidraw library
- `dist/preview` — self-contained PNG renderer binary

## Usage

After deploying, opencode will automatically invoke this skill when asked to create diagrams. The agent will:

1. Write a `.mjs` file with `ExcalidrawElementSkeleton` objects
2. Run `convert.mjs` to produce a `.excalidraw` file
3. Run `dist/preview` to render a PNG
4. Inspect the PNG and iterate as needed

### Running the tools directly

```bash
# Convert a skeleton file to .excalidraw
node dist/convert.mjs diagram.mjs output.excalidraw

# Render a .excalidraw file to PNG
dist/preview output.excalidraw preview.png
```

## Project Structure

```
excalidraw-skill/
├── SKILL.md                    # Skill definition and workflow guide for the agent
├── src/
│   ├── convert.mjs             # CLI: .mjs skeleton → .excalidraw JSON
│   └── preview.js              # CLI: .excalidraw JSON → PNG (also compiled as SEA binary)
├── build/
│   ├── bundle-excalidraw.mjs   # esbuild: bundles @excalidraw/excalidraw → dist/excalidraw.mjs
│   ├── build-preview.mjs       # Multi-step SEA pipeline → dist/preview binary
│   └── deploy.mjs              # Copies artifacts to the opencode skills directory
└── dist/                       # Generated output (not committed)
    ├── excalidraw.mjs          # Bundled Excalidraw library used by convert.mjs
    └── preview                 # Self-contained binary (Node + Resvg + fonts embedded)
```

## Scripts

| Script                  | Description                                                    |
| ----------------------- | -------------------------------------------------------------- |
| `npm run build`         | Full build — produces `dist/excalidraw.mjs` and `dist/preview` |
| `npm run build:lib`     | Bundles only the Excalidraw library to `dist/excalidraw.mjs`   |
| `npm run build:preview` | Builds only the `dist/preview` SEA binary                      |
| `npm run deploy`        | Deploys built artifacts to the opencode skills directory       |

## Tech Stack

|                         |                               |
| ----------------------- | ----------------------------- |
| Diagram conversion      | `@excalidraw/excalidraw`      |
| SVG export              | `@excalidraw/utils`           |
| SVG → PNG rasterization | `@resvg/resvg-js` (Rust/Skia) |
| Bundler                 | `esbuild`                     |
| DOM shim                | `jsdom`                       |
| Binary packaging        | Node.js SEA (`--build-sea`)   |

## Design Notes

- **Browser global stubbing**: `@excalidraw/excalidraw` is a React/browser library. `convert.mjs` stubs ~25 browser globals (`window`, `document`, `canvas`, `FontFace`, `DOMMatrix`, etc.) to make it run in Node without a headless browser.
- **Pre-bundled library**: `dist/excalidraw.mjs` is a tree-shaken ESM bundle, avoiding CJS/ESM interop issues at runtime.
- **SEA binary**: The preview renderer is packaged as a Node.js Single Executable Application with the native Resvg addon and Excalidraw TTF fonts embedded — no external dependencies at runtime.
- **jsdom for preview**: `exportToSvg` from `@excalidraw/utils` needs a more complete DOM than simple stubs can provide, so `preview.js` uses `jsdom`.

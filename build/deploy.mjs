#!/usr/bin/env node

/**
 * Deploys the built skill artifacts to an agent skills directory.
 *
 * Prompts for the target directory, defaulting to:
 *   ~/.config/opencode/skills/excalidraw
 *
 * Copies:
 *   SKILL.md              → <target>/SKILL.md
 *   src/convert.mjs       → <target>/dist/convert.mjs
 *   dist/excalidraw.mjs   → <target>/dist/excalidraw.mjs
 *   dist/preview          → <target>/dist/preview
 *
 * Usage:
 *   node build/deploy.mjs
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import readline from "node:readline";

const __dirname = path.dirname(new URL(import.meta.url).pathname);
const ROOT = path.join(__dirname, "..");

const DEFAULT_SKILL_DIR = path.join(
  os.homedir(),
  ".config",
  "opencode",
  "skills",
  "excalidraw",
);

function prompt(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

const input = await prompt(`Deploy to [${DEFAULT_SKILL_DIR}]: `);
const SKILL_DIR = input
  ? path.resolve(input.replace(/^~/, os.homedir()))
  : DEFAULT_SKILL_DIR;
const SKILL_DIST = path.join(SKILL_DIR, "dist");

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function copyFile(src, dest) {
  if (!fs.existsSync(src)) {
    console.error(`Error: source not found: ${src}`);
    process.exit(1);
  }
  fs.copyFileSync(src, dest);
  // Preserve executable bit for binaries
  const stat = fs.statSync(src);
  fs.chmodSync(dest, stat.mode);
  console.log(`  ${path.relative(ROOT, src)} → ${dest}`);
}

console.log(`Deploying to ${SKILL_DIR} ...\n`);

ensureDir(SKILL_DIR);
ensureDir(SKILL_DIST);

// Clean stale files from previous flat deployment layout
for (const stale of ["build.mjs", "convert.mjs", "preview", ".gitignore"]) {
  const p = path.join(SKILL_DIR, stale);
  if (fs.existsSync(p) && fs.statSync(p).isFile()) {
    fs.unlinkSync(p);
    console.log(`  Removed stale ${stale}`);
  }
}

copyFile(path.join(ROOT, "SKILL.md"), path.join(SKILL_DIR, "SKILL.md"));
copyFile(
  path.join(ROOT, "src", "convert.mjs"),
  path.join(SKILL_DIST, "convert.mjs"),
);
copyFile(
  path.join(ROOT, "dist", "excalidraw.mjs"),
  path.join(SKILL_DIST, "excalidraw.mjs"),
);
copyFile(path.join(ROOT, "dist", "preview"), path.join(SKILL_DIST, "preview"));

console.log("\nDeploy complete.");

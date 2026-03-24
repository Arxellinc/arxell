#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const iconIndexPath = path.join(repoRoot, "frontend", "src", "icons", "index.ts");
const gitignorePath = path.join(repoRoot, ".gitignore");

const START = "# BEGIN AUTO-GENERATED ICON ALLOWLIST";
const END = "# END AUTO-GENERATED ICON ALLOWLIST";
const ICON_GLOB = "frontend/src/icons/*.svg";

const indexContent = fs.readFileSync(iconIndexPath, "utf8");
const gitignoreContent = fs.readFileSync(gitignorePath, "utf8");

const importRegex =
  /import\s+[\w$]+\s+from\s+["']\.\/([^"']+)\.svg\?raw["'];?/g;

const icons = new Set();
for (const match of indexContent.matchAll(importRegex)) {
  icons.add(`${match[1]}.svg`);
}

if (icons.size === 0) {
  throw new Error(`No icon imports found in ${iconIndexPath}`);
}

const sorted = [...icons].sort((a, b) => a.localeCompare(b));
const block = [
  START,
  "# Icons: auto-managed from frontend/src/icons/index.ts",
  ICON_GLOB,
  ...sorted.map((name) => `!frontend/src/icons/${name}`),
  END,
].join("\n");

const blockRegex = new RegExp(`${START}[\\s\\S]*?${END}`, "m");
let nextContent;
if (blockRegex.test(gitignoreContent)) {
  nextContent = gitignoreContent.replace(blockRegex, block);
} else {
  const sep = gitignoreContent.endsWith("\n") ? "\n" : "\n\n";
  nextContent = `${gitignoreContent}${sep}${block}\n`;
}

if (nextContent !== gitignoreContent) {
  fs.writeFileSync(gitignorePath, nextContent, "utf8");
  console.log(`Updated ${path.relative(repoRoot, gitignorePath)} with ${sorted.length} icons.`);
} else {
  console.log(`No changes. ${sorted.length} icons already synced.`);
}

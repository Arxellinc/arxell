#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const args = new Set(process.argv.slice(2));
const checkOnly = args.has("--check");

const cargoTomlPath = path.join(root, "src-tauri", "Cargo.toml");
const tauriConfPath = path.join(root, "src-tauri", "tauri.conf.json");
const frontendPkgPath = path.join(root, "frontend", "package.json");
const frontendLockPath = path.join(root, "frontend", "package-lock.json");

const cargoToml = fs.readFileSync(cargoTomlPath, "utf8");
const cargoVersionMatch = cargoToml.match(/^version\s*=\s*"([^"]+)"\s*$/m);
if (!cargoVersionMatch) {
  throw new Error("Could not find package version in src-tauri/Cargo.toml");
}
const version = cargoVersionMatch[1];

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

const tauriConf = readJson(tauriConfPath);
const frontendPkg = readJson(frontendPkgPath);
const frontendLock = readJson(frontendLockPath);

const diffs = [];

if (tauriConf.version !== version) {
  diffs.push(`${path.relative(root, tauriConfPath)} version=${tauriConf.version} expected=${version}`);
  tauriConf.version = version;
}

if (frontendPkg.version !== version) {
  diffs.push(`${path.relative(root, frontendPkgPath)} version=${frontendPkg.version} expected=${version}`);
  frontendPkg.version = version;
}

if (frontendLock.version !== version) {
  diffs.push(`${path.relative(root, frontendLockPath)} version=${frontendLock.version} expected=${version}`);
  frontendLock.version = version;
}

if (frontendLock.packages && frontendLock.packages[""]?.version !== version) {
  diffs.push(
    `${path.relative(root, frontendLockPath)} packages[\"\"] version=${frontendLock.packages[""]?.version} expected=${version}`
  );
  if (!frontendLock.packages[""]) {
    frontendLock.packages[""] = {};
  }
  frontendLock.packages[""].version = version;
}

if (checkOnly) {
  if (diffs.length > 0) {
    console.error("[version-sync] Version mismatch detected:");
    for (const diff of diffs) {
      console.error(`- ${diff}`);
    }
    process.exit(1);
  }
  console.log(`[version-sync] OK (${version})`);
  process.exit(0);
}

writeJson(tauriConfPath, tauriConf);
writeJson(frontendPkgPath, frontendPkg);
writeJson(frontendLockPath, frontendLock);

if (diffs.length > 0) {
  console.log(`[version-sync] Synced to ${version}`);
  for (const diff of diffs) {
    console.log(`- ${diff}`);
  }
} else {
  console.log(`[version-sync] No changes needed (${version})`);
}

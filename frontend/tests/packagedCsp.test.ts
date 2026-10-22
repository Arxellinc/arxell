import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CONTRACT_VERSION } from "../src/contracts.js";

const config = JSON.parse(readFileSync("../src-tauri/tauri.conf.json", "utf8"));
const directives = new Map<string, string[]>(config.app.security.csp.split(";").map((part: string) => {
  const [name, ...sources] = part.trim().split(/\s+/);
  return [name, sources];
}));

test("packaged CSP permits local presentation media and dynamic CSS, not inline scripts", () => {
  assert.deepEqual(directives.get("default-src"), ["'self'"]);
  assert.deepEqual(directives.get("script-src"), ["'self'"]);
  assert.deepEqual(directives.get("img-src"), ["'self'", "data:", "blob:"]);
  assert.deepEqual(directives.get("media-src"), ["'self'", "data:", "blob:", "mediastream:"]);
  assert.deepEqual(directives.get("style-src"), ["'self'", "'unsafe-inline'"]);
  // Attribute policy is independent of any nonces/hashes Tauri adds to style-src.
  assert.deepEqual(directives.get("style-src-attr"), ["'unsafe-inline'"]);
  assert.deepEqual(directives.get("object-src"), ["'none'"]);
  assert.deepEqual(directives.get("connect-src"), ["'self'", "ipc:", "http://ipc.localhost", "http://127.0.0.1", "data:", "blob:"]);
  assert.equal(config.app.security.dangerousDisableAssetCspModification, undefined);
});

test("image preview contract version is synchronized across frontend, Rust, and docs", () => {
  const rust = readFileSync("../src-tauri/src/contracts.rs", "utf8");
  const docs = readFileSync("../docs/CONTRACT_VERSION.md", "utf8");
  assert.match(rust, new RegExp(`CONTRACT_VERSION: &str = "${CONTRACT_VERSION}"`));
  for (const checkoutText of [docs.replace(/\r\n/g, "\n"), docs.replace(/\r?\n/g, "\r\n")]) {
    assert.ok(checkoutText.replace(/\r\n/g, "\n").includes(`## Current Version\n- \`${CONTRACT_VERSION}\``));
  }
});

test("image previews do not enable an additional filesystem-serving asset protocol", () => {
  assert.notEqual(config.app.security.assetProtocol?.enable, true);
  const cargo = readFileSync("../src-tauri/Cargo.toml", "utf8");
  assert.doesNotMatch(cargo, /protocol-asset/);
  const actions = readFileSync("src/tools/files/actions.ts", "utf8");
  assert.doesNotMatch(actions, /convertFileSrc|asset:\/\//);
});

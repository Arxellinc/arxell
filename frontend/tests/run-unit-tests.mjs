import { rmSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const outDir = ".tmp-tests";

function run(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit", shell: false });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function collectTests(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      collectTests(path, out);
    } else if (entry.endsWith(".test.js")) {
      out.push(path);
    }
  }
  return out;
}

rmSync(outDir, { recursive: true, force: true });
run(process.platform === "win32" ? "npx.cmd" : "npx", ["tsc", "-p", "tsconfig.tests.json"]);

const tests = collectTests(join(outDir, "tests")).sort();
if (!tests.length) {
  console.error(`Could not find emitted test files under ${join(outDir, "tests")}`);
  process.exit(1);
}

run(process.execPath, ["--test", ...tests]);

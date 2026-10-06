import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { FIRST_RUN_MODEL_CATALOG_URL, openFirstRunModelCatalog } from "../src/onboarding/firstRunModelBrowser.js";

test("desktop catalog uses the registered opener command, not shell or a WebView popup", async () => {
  const calls: unknown[] = [];
  await openFirstRunModelCatalog({
    desktop: true,
    invoke: async (command, args) => { calls.push({ command, args }); },
    openWeb: () => { assert.fail("desktop must not open a WebView popup"); }
  });
  assert.deepEqual(calls, [{ command: "plugin:opener|open_url", args: { url: FIRST_RUN_MODEL_CATALOG_URL } }]);
});

test("native failures propagate without an unsafe popup fallback", async () => {
  await assert.rejects(openFirstRunModelCatalog({
    desktop: true,
    invoke: async () => { throw new Error("native open failed"); },
    openWeb: () => { assert.fail("no native fallback"); }
  }), /native open failed/);
});

test("web preview opens the catalog without window-opener access", async () => {
  const calls: string[][] = [];
  await openFirstRunModelCatalog({
    desktop: false,
    invoke: async () => { assert.fail("web preview must not call IPC"); },
    openWeb: (...args) => { calls.push(args); }
  });
  assert.deepEqual(calls, [[FIRST_RUN_MODEL_CATALOG_URL, "_blank", "noopener,noreferrer"]]);
});

test("native capability is local-main only and permits just the literal catalog URL", () => {
  const capability = JSON.parse(readFileSync("../src-tauri/capabilities/default.json", "utf8"));
  assert.deepEqual(capability.windows, ["main"]);
  assert.equal(capability.remote, undefined);
  const permissions = capability.permissions.filter((entry: string | { identifier: string }) =>
    (typeof entry === "string" ? entry : entry.identifier).startsWith("opener:"));
  // The URL scope is a glob: escape '?' rather than granting a one-character wildcard.
  assert.deepEqual(permissions, [{
    identifier: "opener:allow-open-url",
    allow: [{ url: FIRST_RUN_MODEL_CATALOG_URL.replace("?", "[?]") }]
  }]);
});

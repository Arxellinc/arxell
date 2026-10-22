import test from "node:test";
import assert from "node:assert/strict";
import { openFilesFile } from "../src/tools/files/actions.js";
import type { FilesToolStateSlice } from "../src/tools/files/state.js";
import type { ChatIpcClient } from "../src/ipcClient.js";

function fileState(): FilesToolStateSlice {
  // Only the state fields used by file opening are needed in these unit tests.
  return {
    filesOpenTabs: [], filesSelectedPaths: [],
    filesLoadingFileByPath: {}, filesContentByPath: {}, filesSavedContentByPath: {},
    filesDirtyByPath: {}, filesReadOnlyByPath: {}, filesSizeByPath: {},
    filesImagePreviewUrlByPath: {}, filesImageViewMode: "actual", filesError: null
  } as unknown as FilesToolStateSlice;
}

function depsFor(result: { ok: boolean; data: unknown; error?: string }) {
  const calls: unknown[] = [];
  const client = {
    async toolInvoke(request: unknown) { calls.push(request); return result; }
  } as unknown as ChatIpcClient;
  return { calls, deps: { client, nextCorrelationId: () => "image-corr" } };
}

for (const [requested, canonical, mimeType, content] of [
  ["/project/pixel.PNG", "/project/pixel.PNG", "image/png", "AAEC/w=="],
  ["C:\\project\\icon.svg", "C:/project/icon.svg", "image/svg+xml", "PHN2Zy8+"],
] as const) {
  test(`image opening uses one scoped read and a data URL for ${mimeType}`, async () => {
    const state = fileState();
    const { deps, calls } = depsFor({ ok: true, data: {
      correlationId: "image-corr", path: canonical, mimeType, content, sizeBytes: 4
    } });
    // No window or Tauri globals exist here: URL construction must not depend on them.
    await openFilesFile(state, deps, requested);
    assert.deepEqual(calls, [{
      correlationId: "image-corr", toolId: "files", action: "read-image", mode: "sandbox",
      payload: { correlationId: "image-corr", path: requested }
    }]);
    assert.equal(state.filesImagePreviewUrlByPath[canonical], `data:${mimeType};base64,${content}`);
    assert.equal(state.filesActiveTabPath, canonical);
    assert.equal(state.filesReadOnlyByPath[canonical], true);
    assert.equal(state.filesContentByPath[canonical], "");
    assert.equal(state.filesDirtyByPath[canonical], false);
    assert.equal(state.filesLoadingFileByPath[canonical], false);
    assert.equal(state.filesImageViewMode, "fit");
    assert.equal(state.filesError, null);
  });
}

test("denied image reads surface an error and discard the old preview", async () => {
  const state = fileState();
  state.filesImagePreviewUrlByPath["/project/pixel.png"] = "data:image/png;base64,stale";
  const { deps, calls } = depsFor({ ok: false, data: null, error: "outside workspace root" });
  await openFilesFile(state, deps, "/project/pixel.png");
  assert.equal(calls.length, 1);
  assert.equal(state.filesError, "outside workspace root");
  assert.equal(state.filesImagePreviewUrlByPath["/project/pixel.png"], undefined);
  assert.equal(state.filesLoadingFileByPath["/project/pixel.png"], false);
});

test("text files continue using the editor read action and remain editable", async () => {
  const state = fileState();
  const { deps, calls } = depsFor({ ok: true, data: {
    path: "/project/note.txt", content: "plain text", sizeBytes: 10, isBinary: false, readOnly: false
  } });
  await openFilesFile(state, deps, "/project/note.txt");
  assert.equal((calls[0] as { action: string }).action, "read-file");
  assert.equal(state.filesContentByPath["/project/note.txt"], "plain text");
  assert.equal(state.filesReadOnlyByPath["/project/note.txt"], false);
  assert.deepEqual(state.filesImagePreviewUrlByPath, {});
});

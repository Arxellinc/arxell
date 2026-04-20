import test from "node:test";
import assert from "node:assert/strict";

import { resolveFileTabIcon } from "../src/tools/ui/fileTabIcons.js";

test("resolveFileTabIcon maps key file types to the expected icons", () => {
  assert.equal(resolveFileTabIcon("report.csv"), "file-spreadsheet");
  assert.equal(resolveFileTabIcon("notes.md"), "book-open-text");
  assert.equal(resolveFileTabIcon("config.json"), "file-braces");
  assert.equal(resolveFileTabIcon("main.ts"), "file-code");
  assert.equal(resolveFileTabIcon("script.sh"), "file-terminal");
  assert.equal(resolveFileTabIcon("schema.sql"), "database");
  assert.equal(resolveFileTabIcon("photo.png"), "file-image");
  assert.equal(resolveFileTabIcon("backup.zip"), "file-archive");
  assert.equal(resolveFileTabIcon("cert.pem"), "file-key");
  assert.equal(resolveFileTabIcon("unknown.custom"), "file-type");
  assert.equal(resolveFileTabIcon("Untitled", "file-text"), "file-text");
});

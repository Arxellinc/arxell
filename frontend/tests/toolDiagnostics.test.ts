import assert from "node:assert/strict";
import test from "node:test";
import { formatRuntimeEventLine, parseAgentToolPayload } from "../src/app/runtimeOrchestration.js";
import type { AppEvent } from "../src/contracts.js";

test("metadata-only tool progress renders without raw displays", () => {
  assert.deepEqual(parseAgentToolPayload({ toolCallId: "call-1", toolName: "read", success: true }), {
    toolCallId: "call-1", toolName: "read", success: true, display: ""
  });
});

test("older raw tool displays and arguments cannot enter frontend diagnostics", () => {
  const payload = { toolCallId: "call-1", toolName: "bash", success: false,
    display: "private output", arguments: { command: "private command" }, token: "private token" };
  assert.equal(parseAgentToolPayload(payload)?.display, "");
  const event: AppEvent = { timestampMs: 1, correlationId: "corr", subsystem: "tool",
    action: "chat.agent.tool.result", stage: "complete", severity: "info", payload };
  const line = formatRuntimeEventLine(event);
  assert.ok(line.includes("call-1"));
  assert.ok(!line.includes("private"));
});

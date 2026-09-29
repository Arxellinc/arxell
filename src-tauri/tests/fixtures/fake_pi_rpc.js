const readline = require("node:readline");

const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });

function send(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

input.on("line", (line) => {
  const command = JSON.parse(line);
  if (command.type === "abort") {
    send({ id: command.id, type: "response", command: "abort", success: true });
    return;
  }
  if (command.type === "extension_ui_response") {
    if (command.cancelled === true || typeof command.confirmed === "boolean") {
      send({ type: "agent_settled" });
    } else {
      process.stderr.write("extension request response was invalid\n");
      process.exit(8);
    }
    return;
  }
  if (command.type !== "prompt") return;

  send({ id: command.id, type: "response", command: "prompt", success: true });
  if (command.message === "timeout" || command.message.includes("__ARXELL_TIMEOUT__")) return;
  if (command.message === "malformed") {
    process.stdout.write("not-json\n");
    return;
  }
  if (command.message === "crash") {
    process.stderr.write("fixture crash\n");
    process.exit(7);
  }
  if (command.message === "extension") {
    send({ type: "extension_ui_request", id: "approval-1", method: "confirm", message: "Allow?" });
    return;
  }

  send({ type: "agent_start" });
  if (["error", "aborted", "length", "retry-success", "extension-error", "retry-exhausted"].includes(command.message)) {
    const stopReason = ["aborted", "length"].includes(command.message) ? command.message : "error";
    if (command.message === "extension-error") {
      send({ type: "extension_error", error: "fixture policy failure" });
    }
    if (command.message !== "retry-exhausted") {
      send({
        type: "message_end",
        message: { role: "assistant", content: [], stopReason, errorMessage: "sensitive provider diagnostic" }
      });
    }
    if (command.message === "retry-success" || command.message === "extension-error") {
      send({ type: "auto_retry_start", attempt: 1 });
      send({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "recovered" }], stopReason: "stop" } });
      send({ type: "auto_retry_end", success: true });
    } else if (command.message === "retry-exhausted") {
      send({ type: "auto_retry_end", success: false, finalError: "sensitive provider diagnostic" });
    }
    send({ type: "agent_settled" });
    return;
  }
  send({
    type: "message_update",
    message: { role: "assistant", content: [{ type: "text", text: "hello" }] },
    assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "hello" }
  });
  send({ type: "agent_end", messages: [], willRetry: true });
  send({ type: "auto_retry_start", attempt: 1 });
  send({
    type: "message_end",
    message: { role: "assistant", content: [{ type: "text", text: "hello from fixture" }] }
  });
  process.stderr.write("bounded fixture diagnostic\n");
  send({ type: "agent_settled" });
});

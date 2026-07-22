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
    if (command.cancelled === true) {
      send({ type: "agent_settled" });
    } else {
      process.stderr.write("extension request was not rejected\n");
      process.exit(8);
    }
    return;
  }
  if (command.type !== "prompt") return;

  send({ id: command.id, type: "response", command: "prompt", success: true });
  if (command.message === "timeout") return;
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

import { pathToFileURL } from "node:url";
import fs from "node:fs";
import path from "node:path";

const [extensionPath, projectRoot] = process.argv.slice(2);
const executablePolicy = path.join(projectRoot, "arxell-policy-test.mjs");
fs.copyFileSync(extensionPath, executablePolicy);
const { default: installPolicy } = await import(pathToFileURL(executablePolicy).href);
let toolCall;
installPolicy({
  on(name, handler) {
    if (name === "tool_call") toolCall = handler;
  }
});
if (!toolCall) throw new Error("policy did not register tool_call");

let confirmationCount = 0;
const ctx = {
  cwd: projectRoot,
  hasUI: true,
  ui: {
    async confirm() {
      confirmationCount += 1;
      return false;
    }
  }
};

const outside = await toolCall({ toolName: "write", input: { path: "../outside.txt" } }, ctx);
const protectedRead = await toolCall({ toolName: "read", input: { path: ".env" } }, ctx);
const protectedBash = await toolCall({ toolName: "bash", input: { command: "cat .env" } }, ctx);
const destructive = await toolCall({ toolName: "bash", input: { command: "rm -rf build" } }, ctx);
const safe = await toolCall({ toolName: "bash", input: { command: "npm test" } }, ctx);

fs.writeFileSync(path.join(projectRoot, "policy-result.json"), JSON.stringify({
  outsideBlocked: outside?.block === true,
  protectedReadBlocked: protectedRead?.block === true,
  protectedBashBlocked: protectedBash?.block === true,
  destructiveBlocked: destructive?.block === true,
  confirmationCount,
  safeAllowed: safe === undefined
}));

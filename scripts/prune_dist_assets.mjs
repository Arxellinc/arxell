import { existsSync, rmSync } from "node:fs";
import { resolve } from "node:path";

const distLlmDir = resolve(process.cwd(), "dist", "llm");

if (existsSync(distLlmDir)) {
  rmSync(distLlmDir, { recursive: true, force: true });
  console.log(`[build] removed bundled LLM directory: ${distLlmDir}`);
} else {
  console.log("[build] no dist/llm directory to remove");
}

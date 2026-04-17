You are working on the arxell-lite project. The Looper tool is a multi-agent orchestration system (Planner → Executor → Validator → Critic phases) inspired by the Ralph Wiggum technique.

First, read `temp/LOOPER_CONTEXT.md` for full context on what was built, the architecture, and what's remaining.

Then tackle the highest priority remaining task: **iteration looping**. Currently when the Critic phase finishes, the loop just marks itself complete. It should instead:
1. Read the Critic's output to determine SHIP or REVISE
2. If REVISE: increment iteration counter, reset phases, start a new Planner cycle
3. If SHIP: complete the loop

The relevant code is in `src-tauri/src/tools/looper_handler.rs` in the `on_terminal_exit()` method around line 670. After implementing, verify with `cd src-tauri && cargo check --features tauri-runtime`.

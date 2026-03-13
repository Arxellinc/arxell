# Autonomous Agent

## What it is
In arx, agent behavior is implemented through:
- mode-specific system prompts,
- skill/context injection,
- tool-tag parsing (`<write_to_file>`, `<read_file>`, task tags, browser tags),
- optional auto-dispatch of pending tasks.

## User-driven vs agent-driven actions
- User-driven: explicit UI actions (buttons, form changes, panel actions).
- Agent-driven: assistant output contains recognized tool tags; frontend executes corresponding actions.

## Task structure and flow
Tasks are stored in `taskStore` with fields including:
- title, description, project, priority (0-100), status,
- dependencies, due date, effort, creator, criteria, constraints,
- attempts/last error/review timing.

Auto mode behavior:
- Chat panel computes runnable pending tasks (`areDependenciesComplete`, `computeTaskScore`).
- In mode `auto`, it sends an auto-prompt for the top pending task if chat is idle.

## Agent decision loop (implemented behavior)
1. Build extra context (mode + runtime + tasks + MCP + skills + tool prompt).
2. Send chat request.
3. Stream assistant output.
4. Parse supported tool tags in response.
5. Execute mapped actions (file read/write, task update/create, browser fetch).
6. Continue as needed.

## Monitoring and stopping
- Streaming messages shown live in chat.
- Stop button sends cancellation (`cmd_chat_cancel`).
- Terminal/log panels provide additional operational visibility.

## Failure and ambiguity handling
- Tool parsing is strict tag-based.
- Failed tool actions generate explicit error feedback in follow-up context.
- Auto mode currently relies on prompt instructions; no separate planner service exists.

## Known limitations
- No formal hard-scoped task sandbox in prompt layer alone.
- Safety depends heavily on command handlers and panel-specific guardrails.
- Some panel/tool integrations are currently UI/state-level rather than full backend orchestration.

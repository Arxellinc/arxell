---
name: Hook Development
description: This skill should be used when the user asks to create a hook, add a PreToolUse or PostToolUse hook, validate tool use, implement prompt-based hooks, use ${CLAUDE_PLUGIN_ROOT}, set up event-driven automation, block dangerous commands, or mentions hook events such as PreToolUse, PostToolUse, Stop, SessionStart, SessionEnd, UserPromptSubmit, PreCompact, or Notification.
version: 0.1.0
---

# Hook Development for Claude Code Plugins

## Overview

Hooks are event-driven automation scripts that execute in response to Claude Code events.

## Hook Types

- Prompt-based hooks: best for context-aware validation.
- Command hooks: best for deterministic checks and external tools.

## Common Events

- `PreToolUse`
- `PostToolUse`
- `Stop`
- `SubagentStop`
- `UserPromptSubmit`
- `SessionStart`
- `SessionEnd`
- `PreCompact`
- `Notification`

## Configuration Notes

- Plugin hooks typically live in `hooks/hooks.json`.
- Use `${CLAUDE_PLUGIN_ROOT}` for portable script paths.
- Matching hooks run in parallel.
- Hooks load at session start, so restart is required after changes.

## Best Practices

- Prefer prompt-based hooks for complex policy decisions.
- Validate and sanitize all input in command hooks.
- Set appropriate timeouts.
- Keep hook behavior independent and deterministic.

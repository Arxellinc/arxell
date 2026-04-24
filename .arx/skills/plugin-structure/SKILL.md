---
name: Plugin Structure
description: This skill should be used when the user asks to create a plugin, scaffold a plugin, understand plugin structure, organize plugin components, set up plugin.json, use ${CLAUDE_PLUGIN_ROOT}, add commands, agents, skills, hooks, configure auto-discovery, or needs guidance on plugin directory layout, manifest configuration, component organization, file naming conventions, or Claude Code plugin architecture best practices.
version: 0.1.0
---

# Plugin Structure for Claude Code

## Overview

Claude Code plugins follow a standardized directory structure with automatic component discovery.

## Standard Layout

```text
plugin-name/
├── .claude-plugin/
│   └── plugin.json
├── commands/
├── agents/
├── skills/
├── hooks/
│   └── hooks.json
├── .mcp.json
└── scripts/
```

## Critical Rules

- `plugin.json` must live in `.claude-plugin/`.
- Component directories live at plugin root, not inside `.claude-plugin/`.
- Use kebab-case naming.
- Use `${CLAUDE_PLUGIN_ROOT}` for portable file references.

## Components

- Commands: markdown files in `commands/`
- Agents: markdown files in `agents/`
- Skills: `skills/<skill-name>/SKILL.md`
- Hooks: `hooks/hooks.json`
- MCP: `.mcp.json` or inline `mcpServers`

## Best Practices

- Keep manifest lean.
- Rely on auto-discovery where possible.
- Organize files logically.
- Use consistent naming across related components.

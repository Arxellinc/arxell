---
name: Plugin Settings
description: This skill should be used when the user asks about plugin settings, store plugin configuration, user-configurable plugin, .local.md files, plugin state files, read YAML frontmatter, per-project plugin settings, or wants to make plugin behavior configurable.
version: 0.1.0
---

# Plugin Settings Pattern for Claude Code Plugins

## Overview

Plugins can store user-configurable settings and state in `.claude/plugin-name.local.md` files using YAML frontmatter plus markdown body content.

## Core Pattern

```markdown
---
enabled: true
mode: standard
max_retries: 3
---

# Additional Context

Project-specific plugin notes.
```

## Usage

- Read settings from hooks, commands, and agents.
- Use quick-exit behavior if the file does not exist or `enabled` is false.
- Parse frontmatter to extract structured values.
- Use markdown body for prompts, notes, or additional context.

## Best Practices

- Store files in `.claude/`.
- Add `.claude/*.local.md` to `.gitignore`.
- Validate values before use.
- Document that changes require Claude Code restart.

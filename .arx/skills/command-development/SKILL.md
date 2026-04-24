---
name: Command Development
description: This skill should be used when the user asks to create a slash command, add a command, write a custom command, define command arguments, use command frontmatter, organize commands, create command with file references, interactive command, use AskUserQuestion in command, or needs guidance on slash command structure, YAML frontmatter fields, dynamic arguments, bash execution in commands, user interaction patterns, or command development best practices for Claude Code.
version: 0.2.0
---

# Command Development for Claude Code

## Overview

Slash commands are markdown files containing prompts that Claude executes when invoked.

## Core Rule

Commands are instructions for Claude, not messages to the user.

## Basic Format

```markdown
---
description: Review code for security issues
allowed-tools: Read, Grep, Bash(git:*)
model: sonnet
argument-hint: [pr-number]
---

Review this code for security vulnerabilities...
```

## Useful Frontmatter

- `description`
- `allowed-tools`
- `model`
- `argument-hint`
- `disable-model-invocation`

## Dynamic Arguments

- `$ARGUMENTS` captures the full argument string.
- `$1`, `$2`, `$3` capture positional arguments.

## File References

Use `@path/to/file` in command bodies to include file contents.

## Best Practices

- Keep commands single-purpose.
- Always document arguments.
- Use least-privilege tool access.
- Prefer clear names and reusable workflows.

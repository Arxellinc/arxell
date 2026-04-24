---
name: Writing Hookify Rules
description: This skill should be used when the user asks to create a hookify rule, write a hook rule, configure hookify, add a hookify rule, or needs guidance on hookify rule syntax and patterns.
version: 0.1.0
---

# Writing Hookify Rules

## Overview

Hookify rules are markdown files with YAML frontmatter that define patterns to watch for and messages to show when those patterns match.

## Rule File Format

```markdown
---
name: rule-identifier
enabled: true
event: bash|file|stop|prompt|all
pattern: regex-pattern-here
---

Message to show Claude when this rule triggers.
```

## Frontmatter Fields

- `name`: unique kebab-case identifier.
- `enabled`: `true` or `false`.
- `event`: `bash`, `file`, `stop`, `prompt`, or `all`.
- `action`: optional, `warn` or `block`.
- `pattern`: regex for simple rules.

## Advanced Conditions

Use `conditions` for multiple checks such as `file_path`, `new_text`, or `command` with operators like `regex_match`, `contains`, and `equals`.

## Event Guide

- `bash`: match shell commands.
- `file`: match edits and writes.
- `stop`: enforce completion checks.
- `prompt`: inspect user prompts.

## Best Practices

- Keep names descriptive.
- Write clear, actionable warning messages.
- Test regexes before use.
- Store rules in `.claude/hookify.{name}.local.md`.

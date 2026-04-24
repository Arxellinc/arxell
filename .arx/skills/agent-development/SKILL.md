---
name: Agent Development
description: This skill should be used when the user asks to create an agent, add an agent, write a subagent, agent frontmatter, when to use description, agent examples, agent tools, agent colors, autonomous agent, or needs guidance on agent structure, system prompts, triggering conditions, or agent development best practices for Claude Code plugins.
version: 0.1.0
---

# Agent Development for Claude Code Plugins

## Overview

Agents are autonomous subprocesses that handle complex, multi-step tasks independently.

## Agent File Structure

```markdown
---
name: agent-identifier
description: Use this agent when [triggering conditions]...
model: inherit
color: blue
tools: ["Read", "Write", "Grep"]
---

You are [agent role description]...
```

## Frontmatter

- `name`: lowercase, numbers, hyphens only.
- `description`: the most important field. Include triggering conditions and 2-4 `<example>` blocks.
- `model`: `inherit`, `sonnet`, `opus`, `haiku`.
- `color`: `blue`, `cyan`, `green`, `yellow`, `magenta`, `red`.
- `tools`: optional, limit to minimum needed.

## System Prompt Design

Write in second person. Define:
- Core responsibilities
- Analysis process
- Quality standards
- Output format
- Edge cases

## Best Practices

- Include concrete trigger examples.
- Be specific about role and output.
- Test triggering with real scenarios.
- Use least-privilege tool access.

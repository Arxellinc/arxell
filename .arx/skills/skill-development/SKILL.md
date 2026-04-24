---
name: Skill Development
description: This skill should be used when the user wants to create a skill, add a skill to plugin, write a new skill, improve skill description, organize skill content, or needs guidance on skill structure, progressive disclosure, or skill development best practices for Claude Code plugins.
version: 0.1.0
---

# Skill Development for Claude Code Plugins

## About Skills

Skills are modular, self-contained packages that extend Claude's capabilities with specialized workflows, tool usage, and domain knowledge.

## Anatomy of a Skill

```text
skill-name/
├── SKILL.md
├── scripts/
├── references/
└── assets/
```

## Progressive Disclosure

Use a three-level model:
1. Metadata always in context
2. `SKILL.md` body when triggered
3. References, scripts, and assets only as needed

## Creation Process

1. Understand concrete use cases.
2. Plan reusable references, scripts, or examples.
3. Create the skill directory structure.
4. Write `SKILL.md` with strong trigger phrases.
5. Keep the body lean and move details to `references/`.
6. Validate and test triggering behavior.

## Writing Style

- Use third person in the frontmatter description.
- Use imperative or infinitive form in the body.
- Reference bundled resources explicitly.

## Avoid

- Weak trigger descriptions
- Overloading `SKILL.md` with too much detail
- Second-person writing
- Unreferenced support files

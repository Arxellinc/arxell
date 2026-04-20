# Memory And Context UI Options

## What Agents Typically Need

From the current codebase review plus a small scan of common agent-memory patterns:

- Short-term thread state.
  This is the current conversation, attachments, working artifacts, and recent turns.
- Long-term user memory.
  Facts, preferences, stable directives, tone/style, recurring constraints.
- Procedural memory.
  Editable instructions: system prompt fragments, policies, playbooks, skills, and behavioral rules.
- Episodic/session memory.
  Summaries of previous sessions, notable decisions, learned outcomes, and reusable examples.
- Tool awareness.
  Agents need clear tool docs, boundaries, examples, and a simple way to inspect details only when relevant.
- Inclusion policy.
  Not everything should always be injected. Controls should support `always include`, `include when relevant`, `manual only`, and `disabled`.
- Preview/debug surface.
  You need to see the effective context for the next turn and why each item was included.

## Existing UI Pieces Worth Reusing

- `renderToolToolbar()` for tab/action bars.
  `frontend/src/tools/ui/toolbar.ts`
- Files/Skills tree + editor layout for browsing editable prompt/skill documents.
  `frontend/src/tools/files/index.tsx`, `frontend/src/tools/skills/index.tsx`
- Tasks split master-detail layout for list/detail editing.
  `frontend/src/tools/tasks/index.tsx`
- Tool Manager table for registry/catalog style browsing.
  `frontend/src/tools/manager/index.tsx`
- Shared modal/form/data-table classes in `styles.css`.

## UI Option 1: Memory Studio

Single tool with top tabs:

- `Overview`
- `Memory`
- `Sessions`
- `Tools`
- `Policies`
- `Preview`

### How it works

- `Overview`: health/status of current context pipeline, counts, last refresh, what will be included next turn.
- `Memory`: editable records for user facts, preferences, directives, personality.
- `Sessions`: recent conversation summaries and extracted decisions.
- `Tools`: full tool catalog with enabled/disabled, agent-callable, details.
- `Policies`: editable system-prompt fragments, greeting rules, inclusion rules.
- `Preview`: exact effective context and system prompt for next message.

### Reuse

- Toolbar tabs from `renderToolToolbar()`
- Manager-style tables for lists
- Shared modals/forms for add/edit
- Tasks-style details pane for record editing

### Pros

- Easiest to understand
- Everything in one place
- Best debugging surface

### Cons

- Can become crowded if overbuilt
- Needs strong filtering/search

### Recommendation

- This is the best overall option.

## UI Option 2: Control Plane + Editors

Two tools instead of one:

- `Memory`
- `Context`

### How it works

- `Memory` manages stored records: user profile, preferences, directives, session summaries.
- `Context` manages assembly: system prompt sections, inclusion rules, tool index, effective preview.

### Reuse

- `Memory` can use Tasks-style master/detail.
- `Context` can use Skills/Files-style tree + editor tabs for policy docs and prompt fragments.

### Pros

- Cleaner separation between storage and assembly
- Good if prompt engineering is becoming first-class

### Cons

- More navigation overhead
- Users may not know where to edit a given thing

### Recommendation

- Strong if you expect heavy prompt/policy authoring.

## UI Option 3: Inspector-First

Keep the Memory tool mostly as an inspector, but add inline editing and "open in editor" flows.

### Layout

- Left rail: `Current Context`, `Stored Memory`, `Sessions`, `Tools`
- Center list: records/items
- Right detail pane: full detail, inclusion settings, edit form, provenance

### Key idea

- The default mode is "why is the model behaving like this?"
- Every item shows:
  - source
  - last updated
  - inclusion mode
  - current status
  - edit action

### Reuse

- Tasks split-pane layout almost directly
- Manager-style rows for tools
- Shared form fields and modals

### Pros

- Best debugging UX
- Very clear provenance
- Lower risk than a full editor-first interface

### Cons

- Slightly less efficient for bulk editing
- Prompt authors may want richer document editing

### Recommendation

- Good if transparency/debugging is the top priority.

## UI Option 4: Docs-As-Memory

Treat policies, skills, directives, and system prompt fragments as first-class editable documents.

### Layout

- Files/Skills-style tree on the left
- Editor tabs on the right
- Structured metadata panel above or below editor: type, priority, inclusion mode, scope, tags

### Examples

- `user/profile.json`
- `user/preferences.json`
- `policy/greetings.md`
- `policy/system-core.md`
- `skills/*.md`
- `tool-catalog/*.json` or generated views
- `sessions/<conversation-id>.md`

### Pros

- Very flexible
- Great for advanced users
- Reuses existing file/tree/editor patterns heavily

### Cons

- Too abstract for many users
- Easier to make invalid configurations
- Less friendly for quick edits

### Recommendation

- Best as an advanced mode, not the primary UI.

## Recommended Direction

Use **Option 1: Memory Studio**, but borrow two strong ideas:

- from Option 3: show provenance and inclusion status everywhere
- from Option 4: allow opening some items in a richer editor when needed

The tool becomes:

### 1. Overview

Shows:

- active base policy
- number of stored memory items
- recent session summaries
- enabled tools
- effective context size
- warnings

### 2. Memory

Structured editable records:

- `Facts`
- `Preferences`
- `Directives`
- `Personality`

Each record has:

- title/key
- value
- scope
- priority
- inclusion mode
- enabled
- last updated

### 3. Sessions

List of prior sessions with:

- title
- summary
- decisions
- follow-ups
- `pin to current context`
- `open conversation`

### 4. Tools

Catalog of all tools:

- workspace tool
- agent tool names
- enabled
- agent-callable
- short summary
- click for full description/schema/examples

### 5. Policies

Editable context-engineering rules:

- greeting behavior
- project-assumption behavior
- system prompt sections
- skills/directives inclusion rules
- tool-index inclusion rules

### 6. Preview

Shows:

- effective system prompt
- retrieved memory blocks
- included session summaries
- included tool index
- reason each item is included
- estimated token size

## Best Reuse Mapping

- Top nav: `renderToolToolbar()`
- List/detail editor: Tasks tool pattern
- Advanced policy editing: Skills/Files tree editor pattern
- Tool inventory: Tool Manager table pattern
- Add/edit dialogs: shared modal classes
- Forms: shared `.field`, `.field-input`, `.field-select`, `.field-textarea`

## What Should Be Editable

These should be directly editable:

- user facts
- user preferences
- user directives
- personality/style notes
- greeting rules
- project-assumption rules
- skills
- system prompt fragments
- per-item inclusion mode
- tool summaries and tool routing hints
- session summaries
- whether a session summary is eligible for retrieval

These should be harder to edit or partially protected:

- core safety policy
- low-level tool schema
- backend-derived runtime facts

## Simple Inclusion Model

Every memory, policy, or tool summary should have one of:

- `Always`
- `Relevant`
- `Manual`
- `Never`

And a scope:

- `Global`
- `Project`
- `Conversation`

That is much simpler than trying to expose raw prompt plumbing.

## Important Product Rule

Add a first-class editable `Greeting / Assumptions` policy in `Policies`.

That directly fixes the issue surfaced earlier:

- simple greetings should not trigger project-specific onboarding unless the user asks for it

## Best Practical Build Order

1. Build the data model and backend services first.
2. Ship `Overview`, `Memory`, and `Preview`.
3. Add `Tools`.
4. Add `Policies`.
5. Add `Sessions`.
6. Add advanced editor mode for skills/prompt docs only if needed.

## Bottom Line

The cleanest answer is not a giant amorphous memory page. It is a compact **Memory Studio** with:

- structured editable memory
- tool catalog
- policy controls
- effective-context preview

That gives both usability and context-engineering discipline.

## Notes From External References

- LangChain memory guidance emphasizes separating short-term memory from long-term memory, and distinguishing semantic, episodic, and procedural memory.
- Letta's stateful-agent model treats system prompt, memory blocks, messages, and tools as separate but composable state components.
- Anthropic's agent guidance emphasizes simple, composable systems and strong tool documentation rather than overcomplicated frameworks.

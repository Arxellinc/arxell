---
name: notepad-document-editor
description: Create and revise Notepad workspace documents using targeted reads, writes, and line-range edits.
---

# notepad-document-editor

## Use when
- The user asks to create a note, plan, brief, draft, checklist, or other text document in Notepad.
- The user wants a specific section or line range revised without rewriting the whole document.

## Tool routing
- Use `notepad_read` to inspect the current document or a narrow line range before editing.
- Use `notepad_write` to create a new document or replace the full contents when that is actually the right operation.
- Use `notepad_edit_lines` for targeted edits to an existing document so the surrounding content stays intact.

## Editing workflow
1. If the document already exists, read only the lines you need first.
2. Make the smallest correct change.
3. Prefer line-range edits over full rewrites when the request is localized.
4. After writing or editing, rely on the Notepad sync event to surface the updated document in the workspace.

## Constraints
- Treat documents as user-authored content; preserve tone and structure unless the user asks for a rewrite.
- Do not rewrite the whole document just to change a small section.
- Keep paths explicit and stable.

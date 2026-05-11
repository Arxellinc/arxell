# Agent Instructions
- Architecture and App information documents are available in the /docs folder

## Git Workflow

### Branching Model
- `main` is the default branch and source of truth. It should always build and remain releasable.
- **Never commit directly to `main`.** All changes go through branches and pull requests.
- Create a short-lived branch from `main` for each change using prefixes: `feature/`, `fix/`, `docs/`, `refactor/`, `test/`, `ci/`.
- Delete the branch after the PR is merged.

### Workflow for Every Change
1. `git checkout main && git pull`
2. `git checkout -b <prefix>/<short-description>`
3. Make changes.
4. Verify: `cd frontend && npm run build && npm run lint` (and `cd src-tauri && cargo check` for Rust changes).
5. `git add -A && git commit -m "<descriptive message>"`
6. `git push -u origin <branch-name>`
7. `gh pr create --title "<title>" --body "<description>"`
8. Merge via GitHub (squash and merge).
9. `git checkout main && git pull && git branch -d <branch-name>`

### Releasing
1. Bump version in `src-tauri/Cargo.toml`.
2. Run `node scripts/version-sync.mjs` to sync across all config files.
3. `git add -A && git commit -m "Release v0.3.0"`
4. `git tag v0.3.0 && git push origin main --tags`
5. CI builds artifacts automatically on `v*` tags.


## Build & Dev Commands
- `cd frontend && npm run dev` — start dev server
- `cd frontend && npm run build` — production build
- `cd frontend && npm run lint` — run linter

## CSS Conventions

### File Structure
- `frontend/src/styles.css` — global styles, CSS variables, shared UI components
- `frontend/src/tools/<tool>/styles.css` — tool-specific styles only

### CSS Variable Reference (defined in `:root` in `styles.css`)

#### Colors
| Variable | Purpose |
|----------|---------|
| `--ink` | Primary text color |
| `--muted` | Secondary/muted text color |
| `--line` | Border color |
| `--accent` | Accent/highlight color |
| `--accent-ink` | Text on accent-colored backgrounds |
| `--error` | Error/danger color |
| `--status-success` | Success/healthy status (green) |
| `--status-warning` | Warning status (amber) |
| `--status-info` | Info status (blue) |
| `--bg` | Page background |
| `--panel` | Panel background |
| `--sidebar-bg` | Sidebar background |
| `--hover-bg` | Hover state background |
| `--active-bg` | Active/selected background |
| `--active-line` | Active/selected border color |
| `--surface` | Surface background |
| `--surface-soft` | Slightly elevated surface |
| `--surface-strong` | Strong/base surface |
| `--surface-hover` | Surface hover state |
| `--icon-dark` | Icon color (dark mode / default) |
| `--icon-light` | Icon color (light backgrounds) |
| `--icon-inactive` | Disabled/inactive icon color |

#### Font Sizes (use these, not raw rem values)
| Variable | Size |
|----------|------|
| `--text-2xs` | 0.625rem |
| `--text-xs` | 0.6875rem |
| `--text-sm` | 0.75rem |
| `--text-md` | 0.8125rem |
| `--text-lg` | 0.875rem |
| `--text-base` | 1rem |
| `--text-xl` | 1.25rem |
| `--text-2xl` | 1.5rem |

#### Layout Dimensions
| Variable | Purpose |
|----------|---------|
| `--sidebar-w` | Sidebar width (44px) |
| `--global-bar-h` | Top bar height (38px) |
| `--bottom-bar-h` | Bottom bar height (20px) |
| `--pane-bar-h` | Pane header height (38px) |
| `--tool-toolbar-h` | Tool toolbar height (28px) |
| `--tool-tab-h` | Tool tab height (24px) |

### Shared Utility Classes (in `styles.css`)

Always prefer these over tool-specific equivalents.

#### Modals
| Class | Purpose |
|-------|---------|
| `.modal-backdrop` | Absolute-positioned overlay for in-tool modals |
| `.modal-backdrop-fixed` | Fixed-positioned overlay for full-screen modals |
| `.modal-box` | Dialog box container (500px max-width) |
| `.modal-box-fixed` | Fixed-style dialog box (for fixed overlays) |
| `.modal-title` | Dialog title text |
| `.modal-actions` | Dialog action button row |
| `.modal-btn` | Standard dialog button |
| `.modal-btn-danger` | Danger dialog button (red) |

#### Form Fields
| Class | Purpose |
|-------|---------|
| `.field` | Field label + input wrapper |
| `.field-input` | Standard text/number input |
| `.field-input-soft` | Input with soft (lighter) background |
| `.field-select` | Select dropdown |
| `.field-textarea` | Multi-line textarea |
| `.field-textarea-soft` | Textarea with soft background |

#### Layout
| Class | Purpose |
|-------|---------|
| `.pane-title` | Section title bar (30px height, muted, bottom border) |
| `.icon-btn` | Small icon button (24px, border, rounded) |
| `.icon-btn-sm` | Smaller icon button variant (20px) |
| `.icon-btn.is-danger` | Icon button with danger hover state |

#### Split Panes
| Class | Purpose |
|-------|---------|
| `.split-resizer` | Draggable resizer handle |
| `.split-resizer.is-col` | Vertical (column) resizer |
| `.split-resizer.is-row` | Horizontal (row) resizer |
| `.is-resizing-col` | Applied to root while dragging column |
| `.is-resizing-row` | Applied to root while dragging row |

#### Data Tables
| Class | Purpose |
|-------|---------|
| `.data-table` | Table container with border + rounded corners |
| `.data-table-header` | Header row (uppercase, muted, bg) |
| `.data-table-row` | Data row |
| `.data-table-col` | Cell with ellipsis overflow |
| `.data-table-col-actions` | Right-aligned action cell |

#### Code Editor
| Class | Purpose |
|-------|---------|
| `.code-editor` | Editor container grid |
| `.code-editor-scroll` | Scrollable editor wrapper |
| `.code-editor-lines` | Line number gutter |
| `.code-editor-code-wrap` | Code area wrapper |
| `.code-editor-highlight` | Syntax-highlighted overlay |
| `.code-editor-input` | Transparent textarea input |
| `.code-editor-panel.is-wrap` | Wrap mode variant |

### Rules for Tool CSS Files
1. **Always use the variables above** — never hardcode colors. Use `var(--ink)` not `#c7d2d3`, `var(--line)` not `#61787a`.
2. **Never create new CSS variables for colors** that duplicate existing ones (e.g., don't add `--text` as a color alias — use `--ink`).
3. **Use font-size variables** — use `var(--text-xs)` or `var(--text-sm)` instead of raw `0.75rem`.
4. **Reuse existing shared classes** before creating new ones (see tables above).
5. **Scope all tool classes** with the tool name prefix (e.g., `.flow-*`, `.files-*`, `.tasks-*`).
6. **Keep tool CSS minimal** — only styles unique to that tool that don't already exist in `styles.css`.
7. **Tool-specific button styles** should use `.tool-action-btn` (22px) or `.icon-btn` (24px) as base — don't recreate button styles.

### Known Issues


# Theming and Customization

## Current implementation status
A full user-selectable theme system is not fully implemented yet.

What exists today:
- Predominantly dark, hardcoded styling via Tailwind classes and inline colors.
- Global stylesheet (`src/index.css`) with some base styles.
- Many component-level color classes (e.g. `bg-[#111111]`, `text-white/..`).

## User customization currently available
- Functional customization (modes, skills, model/API configs, voice/VAD settings, tool panels).
- No robust theme picker with persisted token sets in source.

## Gaps for robust theming
- Hardcoded color/opacity values scattered across components.
- Inline styles in some components.
- Lack of unified design token map (CSS custom properties) for semantic colors/spacing/typography.

## Recommended theming structure
1. Define semantic CSS variables in `:root` (and optional `[data-theme="..."]` variants).
2. Use variables in Tailwind utility mapping or custom classes.
3. Persist selected theme in `settings` table and apply on startup.
4. Convert panel/component hardcoded values to semantic tokens incrementally.

Example token categories:
- `--bg-app`, `--bg-surface`, `--bg-panel`, `--fg-primary`, `--fg-muted`,
- `--accent-primary`, `--accent-success`, `--accent-warning`, `--accent-danger`,
- spacing/radius/shadow tokens where helpful.

## Limitations to communicate
- Until tokenization is complete, third-party/custom themes will be partial and fragile.

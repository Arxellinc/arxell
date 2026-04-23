# Website Plugin — Implementation Plan

## Overview

Build a professional, self-contained marketing landing page for **Arxell Lite** that runs as a sandboxed iframe workspace tool. The page should showcase the app's features, architecture, and benefits in a style comparable to landing pages of tools like Cursor, Linear, or Warp.

**Constraints:**
- All assets must be self-contained in `dist/index.html` + `dist/main.js` (no external CSS frameworks, no remote fonts, no CDN).
- Runs in a sandboxed iframe — no Tauri API access, no direct file system calls.
- Must respect the app's dark-first aesthetic (cyan accent `#00f0ff`, dark backgrounds).
- No build step required for the plugin; raw HTML/CSS/JS.

---

## Phase 1: Foundation & Structure

### 1.1 HTML Skeleton & Navigation
- Single-page layout with sticky/fixed top navigation bar.
- Nav items: Logo/Brand, Features, Architecture, Voice, Tools, Agent (anchor links).
- Smooth-scroll anchor navigation.
- Responsive meta viewport (though the iframe has fixed width in-app, the page should handle varying widths).

### 1.2 CSS Design System (Inline)
- Define CSS custom properties matching Arxell's visual identity:
  - Primary background: `#0d1115` / `#10151b`
  - Surface: `#151d26` / `#1c2427`
  - Accent: `#00f0ff` (cyan)
  - Text: `#c7d2d3` (primary), `#9aa8b8` (secondary)
  - Border: `#2d3948`
  - Error/success badges
- Typography system using system fonts (`"Segoe UI", "SF Pro Text", "Noto Sans", sans-serif`) — no external fonts.
- Spacing scale, border-radius tokens, transition timing.

### 1.3 Hero Section
- App name "Arxell Lite" with bold typography.
- Tagline (to be finalized — see `questions.md`).
- 2-3 sentence value proposition highlighting: local-first AI, voice pipeline, multi-agent orchestration.
- Two CTA-style elements: "Get Started" (subtle, informational), "Explore Features" (scroll link).
- Subtle animated gradient or glow effect behind the hero text (CSS-only, no JS animation library).

### 1.4 Section Layout System
- Full-width sections with max-width content containers (~900px).
- Consistent section headers: small uppercase label + large heading + subtitle.
- Alternating subtle background tones for visual separation.

---

## Phase 2: Content Sections

### 2.1 Key Features Grid
- 6-8 feature cards in a responsive 2-column or 3-column grid.
- Each card: icon (CSS/SVG), title, 2-line description.
- Proposed features to highlight:
  1. **AI Chat** — Streaming responses, reasoning mode, multi-model support
  2. **Voice Pipeline** — Full STT/TTS/VAD stack, 5 TTS engines, live voice conversations
  3. **Local Models** — Run LLMs locally via llama.cpp, GGUF model management, HuggingFace integration
  4. **Terminal** — Integrated PTY shell, multi-session support
  5. **Files & Sheets** — File browser/editor + spreadsheet viewer
  6. **Web Search** — Inline web search for grounding responses
  7. **Charts & Diagrams** — Mermaid rendering, flowcharts, architecture diagrams
  8. **Plugin System** — Extensible with custom tools, sandboxed plugins

### 2.2 Architecture Section
- Visual representation of the 5-layer architecture (Frontend → IPC → Services → Registry → Tools).
- Layered diagram using CSS (stacked horizontal bars or a vertical flow).
- Brief description of each layer.
- Emphasis on: typed contracts, correlation IDs, structured events, security guardrails.

### 2.3 Voice Pipeline Showcase
- Dedicated section for the voice capabilities (a major differentiator).
- Sub-features listed:
  - STT backends (Whisper.cpp, Sherpa-ONNX)
  - TTS engines (Kokoro, Piper, Matcha, Kitten, Pocket)
  - VAD with multi-method support, shadow evaluation
  - Duplex modes (single-turn, speculative, shadow)
- Visual: CSS pipeline diagram showing audio → STT → Chat → TTS → Audio flow.

### 2.4 Workspace Tools Gallery
- Visual grid/table of all 12 builtin tools with icons and one-line descriptions.
- Organized by category: Workspace, Agent, Data, Ops.
- Hover effect revealing extended description.

### 2.5 Agent & Multi-Agent Section
- OpenCode Agent: embedded Rust coding agent, native tools, streaming events.
- Looper: multi-agent orchestration with Planner → Executor → Validator → Critic loop.
- Skills System: 8 specialized agent skill packs.
- Visual: simple flow diagram of the Looper cycle.

### 2.6 Privacy & Local-First Section
- Key selling points:
  - Local-first architecture — your data stays on your machine
  - Encrypted API key storage
  - Sandboxed plugin system
  - No telemetry, no cloud dependency for core features
  - Run models fully offline

### 2.7 Cross-Platform Section
- Windows, macOS, Linux support callout.
- Simple icon row for each platform.

---

## Phase 3: Visual Polish & Interactivity

### 3.1 Scroll Animations
- Intersection Observer-based fade-in/slide-up for sections as they scroll into view.
- Staggered card animations for feature grids.
- Lightweight — no animation library, just CSS transitions + JS class toggling.

### 3.2 Interactive Elements
- Hover effects on cards (subtle border glow, translate-y lift).
- Tool gallery: click/hover to expand description.
- Architecture diagram: hover to highlight a layer and show its description.

### 3.3 Hero Visual Enhancement
- CSS-only animated gradient mesh or aurora effect behind hero text.
- Subtle particle/dot grid pattern (CSS background-image with radial-gradient).

### 3.4 Footer
- App version, copyright, links to documentation sections.
- Minimal, dark, matches the overall aesthetic.

---

## Phase 4: Refinement

### 4.1 Performance
- Ensure the page loads instantly (no heavy JS, no external resources).
- All SVG icons inline or as CSS background-images.
- Minimal JS — only scroll animations and interactive toggles.

### 4.2 Accessibility
- Semantic HTML structure (header, main, section, nav, footer).
- Proper heading hierarchy (h1 → h2 → h3).
- Sufficient color contrast on text elements.
- Keyboard-navigable anchor links.

### 4.3 Edge Cases
- Handle narrow iframe widths gracefully (single-column fallback).
- Ensure no horizontal overflow.
- Test with both light and dark color-scheme preferences.

---

## File Structure

```
plugins/website/
├── dist/
│   ├── index.html          # Complete HTML + inline CSS + sections
│   └── main.js             # Scroll animations, interactions, postMessage bridge
├── manifest.json           # Plugin metadata (existing)
├── permissions.json        # files.read capability (existing)
├── implementation_plan.md  # This file
└── questions.md            # Open decisions for review
```

---

## Implementation Order

| Step | Task | Phase | Priority |
|------|------|-------|----------|
| 1 | HTML skeleton, nav, CSS design system | 1 | P0 |
| 2 | Hero section with tagline & CTA | 1 | P0 |
| 3 | Key features grid (8 cards) | 2 | P0 |
| 4 | Architecture section with layered diagram | 2 | P0 |
| 5 | Voice pipeline showcase section | 2 | P1 |
| 6 | Workspace tools gallery | 2 | P1 |
| 7 | Agent & multi-agent section | 2 | P1 |
| 8 | Privacy & local-first section | 2 | P2 |
| 9 | Cross-platform & footer | 2 | P2 |
| 10 | Scroll animations (Intersection Observer) | 3 | P1 |
| 11 | Interactive hover/click effects | 3 | P2 |
| 12 | Hero visual enhancement (gradient/aurora) | 3 | P2 |
| 13 | Accessibility & responsiveness pass | 4 | P2 |
| 14 | Final polish & edge case testing | 4 | P3 |

---

## Technical Notes

- **No build tooling**: Write raw HTML/CSS/JS directly into `dist/`. No bundler, no TypeScript.
- **No external dependencies**: No Tailwind, no Google Fonts, no CDN links, no icon libraries. All styling is custom CSS. All icons are inline SVG.
- **Icon strategy**: Use inline SVG paths for tool/feature icons. Reference the Lucide icon set for paths (same icon library the app uses).
- **Color palette**: Strictly derived from the app's existing CSS variables (`--bg`, `--accent`, `--ink`, etc.) to maintain brand consistency.
- **postMessage bridge**: The `main.js` should still post `plugin.ready` to parent for proper tool initialization, and listen for `plugin.init`/`customTool.init`.
- **Estimated size**: Target < 30KB total (HTML + CSS + JS) for fast iframe loading.

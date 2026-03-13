export const CODER_TOOL_DOCS = `## Coder Tool Documentation

Coder wraps the Pi coding agent CLI.

### Runtime
- Executable: configurable via \`coder_pi_executable\` setting (default: \`pi\`)
- Working directory: active project workspace (or provided \`cwd\`)
- Optional model override: \`coder_model\` setting or \`<model>\` in tool payload

### CLI Usage
- Interactive session: \`pi\`
- One-shot prompt: \`pi exec "your coding task"\`
- Version check: \`pi --version\`
- Optional model: \`pi exec --model <model_id> "..." \`

### Agent Tool Tag
\`\`\`xml
<coder_run>
  <prompt>implement feature/fix</prompt>
  <cwd>optional/absolute/path</cwd>
  <timeout_ms>300000</timeout_ms>
  <model>optional-model-id</model>
</coder_run>
\`\`\`

### Guardrails
- Default mode is shell (no sandbox root guard)
- Sandbox mode requires a valid project root guard
- Root mode requires explicit confirmation
`;

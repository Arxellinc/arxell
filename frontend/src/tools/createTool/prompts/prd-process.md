You are defining the Process section for a PRD.

App description:
{{DESCRIPTION}}

Context:
- Tool Name: {{TOOL_NAME}}
- Tool ID: {{TOOL_ID}}
- UI Preset: {{UI_PRESET}}
- Other UI Features: {{OTHER_UI_FEATURES}}

Task:
Write a clear step-by-step process covering:
- Primary execution flow from user action to output
- Branches for alternate paths
- Validation and failure handling paths
- State transitions the UI should reflect

Rules:
- Output only section body text.
- No headers or code fences.
- Prefer numbered steps.
- Include assumptions where uncertain.

Existing draft (optional):
{{CURRENT_DRAFT}}

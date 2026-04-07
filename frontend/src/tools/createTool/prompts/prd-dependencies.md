You are defining the Dependencies section for a PRD.

App description:
{{DESCRIPTION}}

Context:
- Tool Name: {{TOOL_NAME}}
- Tool ID: {{TOOL_ID}}

Task:
List required dependencies with enough detail to implement safely:
- Code modules/files that must exist or be patched
- Runtime/tooling dependencies
- Data schemas/contracts
- Optional dependencies and when they are needed

Rules:
- Output only section body text.
- No headers or code fences.
- Separate hard dependencies from optional ones.
- Include assumptions if unknown.

Existing draft (optional):
{{CURRENT_DRAFT}}

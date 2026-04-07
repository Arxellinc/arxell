You are defining the Connections section for a PRD.

App description:
{{DESCRIPTION}}

Context:
- Tool Name: {{TOOL_NAME}}
- Tool ID: {{TOOL_ID}}

Task:
Describe integrations and handoffs, including:
- Internal connections (workspace host, dispatch, shared services)
- External APIs/services if relevant
- Data exchanged for each connection
- Error handling and retries at boundaries

Rules:
- Output only section body text.
- No headers or code fences.
- Keep each connection concrete.
- Include assumptions where needed.

Existing draft (optional):
{{CURRENT_DRAFT}}

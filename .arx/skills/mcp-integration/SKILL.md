---
name: MCP Integration
description: This skill should be used when the user asks to add an MCP server, integrate MCP, configure MCP in plugin, use .mcp.json, set up Model Context Protocol, connect external service, mentions ${CLAUDE_PLUGIN_ROOT} with MCP, or discusses MCP server types such as SSE, stdio, HTTP, or WebSocket.
version: 0.1.0
---

# MCP Integration for Claude Code Plugins

## Overview

Model Context Protocol enables Claude Code plugins to integrate external services and APIs by exposing structured tools.

## Configuration Methods

- Dedicated `.mcp.json` at plugin root
- Inline `mcpServers` in `plugin.json`

## Server Types

- `stdio`: local process execution
- `sse`: hosted MCP servers with OAuth flows
- `http`: REST API style integration
- `ws`: realtime websocket integration

## Best Practices

- Use `${CLAUDE_PLUGIN_ROOT}` for portable paths.
- Use secure transports such as HTTPS or WSS.
- Pre-allow only the MCP tools you actually need.
- Document required environment variables.
- Test with `/mcp` and `claude --debug`.

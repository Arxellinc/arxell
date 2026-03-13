#!/usr/bin/env node
/**
 * responses_proxy.js
 *
 * A lightweight Node.js HTTP proxy that translates OpenAI Responses API
 * (POST /v1/responses) requests into standard Chat Completions API calls
 * (POST /chat/completions), then streams the result back in Responses API
 * SSE format.
 *
 * This allows Codex CLI (which only speaks the Responses API wire protocol)
 * to work with providers like Z.ai that only support /chat/completions.
 *
 * Role mapping:
 *   "developer" → "system"   (Responses API uses "developer", chat uses "system")
 *
 * Usage:
 *   node responses_proxy.js --port 40823 --upstream-url https://api.z.ai/v1 --api-key sk-...
 *
 * Or via environment variables:
 *   PROXY_PORT=40823 PROXY_UPSTREAM_URL=https://api.z.ai/v1 PROXY_API_KEY=sk-...
 */

'use strict';

const http = require('http');
const https = require('https');
const { URL } = require('url');

// ---------------------------------------------------------------------------
// Config from CLI args or env
// ---------------------------------------------------------------------------
function parseArgs() {
  const args = process.argv.slice(2);
  const cfg = {
    port: parseInt(process.env.PROXY_PORT || '0', 10),
    upstreamUrl: process.env.PROXY_UPSTREAM_URL || '',
    apiKey: process.env.PROXY_API_KEY || '',
  };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--port' && args[i + 1]) cfg.port = parseInt(args[++i], 10);
    else if (args[i] === '--upstream-url' && args[i + 1]) cfg.upstreamUrl = args[++i];
    else if (args[i] === '--api-key' && args[i + 1]) cfg.apiKey = args[++i];
  }
  return cfg;
}

const cfg = parseArgs();

if (!cfg.upstreamUrl) {
  process.stderr.write('responses_proxy: --upstream-url is required\n');
  process.exit(1);
}

// Normalise upstream: strip trailing slash, ensure no /v1/responses suffix
const upstreamBase = cfg.upstreamUrl.replace(/\/+$/, '');

// ---------------------------------------------------------------------------
// Role mapping
// ---------------------------------------------------------------------------
function mapRole(role) {
  if (role === 'developer') return 'system';
  return role; // user, assistant, system, tool, function – pass through
}

// ---------------------------------------------------------------------------
// Convert Responses API input items → chat messages
// ---------------------------------------------------------------------------
function inputToMessages(input) {
  if (typeof input === 'string') {
    return [{ role: 'user', content: input }];
  }
  if (!Array.isArray(input)) return [];

  const messages = [];
  for (const item of input) {
    if (!item || typeof item !== 'object') continue;
    const role = mapRole(item.role || 'user');
    // content can be a string or array of content parts
    let content = item.content;
    if (Array.isArray(content)) {
      // Extract text from content parts
      const textParts = content
        .filter((p) => p && (p.type === 'input_text' || p.type === 'text'))
        .map((p) => p.text || '')
        .join('');
      content = textParts || JSON.stringify(content);
    } else if (typeof content !== 'string') {
      content = String(content || '');
    }
    messages.push({ role, content });
  }
  return messages;
}

// ---------------------------------------------------------------------------
// Build chat completions request body from Responses API body
// ---------------------------------------------------------------------------
function buildChatRequest(responsesBody) {
  const messages = inputToMessages(responsesBody.input || []);
  const req = {
    model: responsesBody.model || 'gpt-4o',
    messages,
    stream: true,
  };

  if (responsesBody.max_output_tokens) req.max_tokens = responsesBody.max_output_tokens;
  if (typeof responsesBody.temperature === 'number') req.temperature = responsesBody.temperature;
  if (typeof responsesBody.top_p === 'number') req.top_p = responsesBody.top_p;

  // System / instructions at top level
  if (responsesBody.instructions) {
    // Prepend as system message if not already present
    const hasSys = messages.some((m) => m.role === 'system');
    if (!hasSys) {
      messages.unshift({ role: 'system', content: responsesBody.instructions });
    }
  }

  return req;
}

// ---------------------------------------------------------------------------
// SSE helpers
// ---------------------------------------------------------------------------
function sseEvent(res, eventName, data) {
  res.write(`event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`);
}

// ---------------------------------------------------------------------------
// Translate a streaming chat completions response → Responses API SSE
// ---------------------------------------------------------------------------
function streamChatToResponses(chatStream, res, responseId, model) {
  let buffer = '';
  let fullText = '';
  let outputItemIndex = 0;

  // Emit response.created
  sseEvent(res, 'response.created', {
    type: 'response.created',
    response: { id: responseId, object: 'realtime.response', status: 'in_progress', output: [] },
  });

  // Emit output_item.added
  sseEvent(res, 'response.output_item.added', {
    type: 'response.output_item.added',
    response_id: responseId,
    output_index: outputItemIndex,
    item: {
      id: `msg_${responseId}`,
      object: 'realtime.item',
      type: 'message',
      status: 'in_progress',
      role: 'assistant',
      content: [],
    },
  });

  // Emit content part added
  sseEvent(res, 'response.content_part.added', {
    type: 'response.content_part.added',
    response_id: responseId,
    item_id: `msg_${responseId}`,
    output_index: outputItemIndex,
    content_index: 0,
    part: { type: 'output_text', text: '' },
  });

  chatStream.on('data', (chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop(); // keep incomplete line

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed === 'data: [DONE]') continue;
      if (!trimmed.startsWith('data: ')) continue;
      const jsonStr = trimmed.slice(6);
      let parsed;
      try {
        parsed = JSON.parse(jsonStr);
      } catch {
        continue;
      }
      const delta = parsed?.choices?.[0]?.delta;
      if (!delta) continue;
      const text = delta.content;
      if (typeof text === 'string' && text.length > 0) {
        fullText += text;
        sseEvent(res, 'response.output_text.delta', {
          type: 'response.output_text.delta',
          response_id: responseId,
          item_id: `msg_${responseId}`,
          output_index: outputItemIndex,
          content_index: 0,
          delta: text,
        });
      }
    }
  });

  chatStream.on('end', () => {
    // Flush any remaining buffer
    if (buffer.trim() && buffer.trim() !== 'data: [DONE]') {
      // ignore partial last line
    }

    // Emit text done
    sseEvent(res, 'response.output_text.done', {
      type: 'response.output_text.done',
      response_id: responseId,
      item_id: `msg_${responseId}`,
      output_index: outputItemIndex,
      content_index: 0,
      text: fullText,
    });

    // Emit content part done
    sseEvent(res, 'response.content_part.done', {
      type: 'response.content_part.done',
      response_id: responseId,
      item_id: `msg_${responseId}`,
      output_index: outputItemIndex,
      content_index: 0,
      part: { type: 'output_text', text: fullText },
    });

    // Emit output_item.done
    sseEvent(res, 'response.output_item.done', {
      type: 'response.output_item.done',
      response_id: responseId,
      output_index: outputItemIndex,
      item: {
        id: `msg_${responseId}`,
        object: 'realtime.item',
        type: 'message',
        status: 'completed',
        role: 'assistant',
        content: [{ type: 'output_text', text: fullText }],
      },
    });

    // Emit response.completed
    sseEvent(res, 'response.completed', {
      type: 'response.completed',
      response: {
        id: responseId,
        object: 'realtime.response',
        status: 'completed',
        output: [
          {
            id: `msg_${responseId}`,
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: fullText }],
          },
        ],
        model,
      },
    });

    res.end();
  });

  chatStream.on('error', (err) => {
    process.stderr.write(`responses_proxy: stream error: ${err.message}\n`);
    sseEvent(res, 'error', { type: 'error', error: { message: err.message } });
    res.end();
  });
}

// ---------------------------------------------------------------------------
// Forward request to upstream chat completions
// ---------------------------------------------------------------------------
function forwardToChatCompletions(chatBody, apiKey, callback) {
  const chatUrl = new URL(`${upstreamBase}/chat/completions`);
  const bodyStr = JSON.stringify(chatBody);

  const options = {
    hostname: chatUrl.hostname,
    port: chatUrl.port || (chatUrl.protocol === 'https:' ? 443 : 80),
    path: chatUrl.pathname + (chatUrl.search || ''),
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(bodyStr),
      Accept: 'text/event-stream',
    },
  };

  if (apiKey) {
    options.headers['Authorization'] = `Bearer ${apiKey}`;
  }

  const proto = chatUrl.protocol === 'https:' ? https : http;
  const upstreamReq = proto.request(options, (upstreamRes) => {
    if (upstreamRes.statusCode !== 200) {
      let errBody = '';
      upstreamRes.on('data', (d) => (errBody += d.toString()));
      upstreamRes.on('end', () => {
        callback(new Error(`upstream ${upstreamRes.statusCode}: ${errBody}`), null);
      });
      return;
    }
    callback(null, upstreamRes);
  });

  upstreamReq.on('error', (err) => callback(err, null));
  upstreamReq.write(bodyStr);
  upstreamReq.end();
}

// ---------------------------------------------------------------------------
// ID generator
// ---------------------------------------------------------------------------
let _idCounter = 0;
function newResponseId() {
  return `proxy_${Date.now()}_${++_idCounter}`;
}

// ---------------------------------------------------------------------------
// Main HTTP handler
// ---------------------------------------------------------------------------
const server = http.createServer((req, res) => {
  // Health check
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('ok');
    return;
  }

  // Only handle POST /v1/responses
  if (req.method !== 'POST' || !req.url.startsWith('/v1/responses')) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'Not found', type: 'proxy_error' } }));
    return;
  }

  let body = '';
  req.on('data', (chunk) => (body += chunk.toString()));
  req.on('end', () => {
    let responsesBody;
    try {
      responsesBody = JSON.parse(body);
    } catch (e) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Invalid JSON', type: 'proxy_error' } }));
      return;
    }

    // Extract API key: prefer Authorization header from incoming request, fallback to cfg
    let apiKey = cfg.apiKey;
    const authHeader = req.headers['authorization'];
    if (authHeader && authHeader.startsWith('Bearer ')) {
      apiKey = authHeader.slice(7).trim() || apiKey;
    }

    const chatBody = buildChatRequest(responsesBody);
    const responseId = newResponseId();
    const model = chatBody.model;

    forwardToChatCompletions(chatBody, apiKey, (err, chatStream) => {
      if (err) {
        process.stderr.write(`responses_proxy: upstream error: ${err.message}\n`);
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: err.message, type: 'proxy_error' } }));
        return;
      }

      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });

      streamChatToResponses(chatStream, res, responseId, model);
    });
  });

  req.on('error', (err) => {
    process.stderr.write(`responses_proxy: request error: ${err.message}\n`);
  });
});

// ---------------------------------------------------------------------------
// Start server
// ---------------------------------------------------------------------------
server.listen(cfg.port, '127.0.0.1', () => {
  const addr = server.address();
  // Print the actual bound port to stdout so the Rust parent can read it
  process.stdout.write(`PROXY_READY port=${addr.port}\n`);
  process.stderr.write(`responses_proxy: listening on 127.0.0.1:${addr.port} → ${upstreamBase}\n`);
});

server.on('error', (err) => {
  process.stderr.write(`responses_proxy: server error: ${err.message}\n`);
  process.exit(1);
});

// Graceful shutdown
process.on('SIGTERM', () => server.close(() => process.exit(0)));
process.on('SIGINT', () => server.close(() => process.exit(0)));

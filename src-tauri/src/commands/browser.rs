//! Browser proxy — webproxy:// URI scheme handler and AI fetch command.
//!
//! The webproxy:// scheme intercepts requests from the embedded iframe, fetches
//! them server-side with reqwest, strips X-Frame-Options / CSP frame-ancestors,
//! and optionally transforms the page (browser / reader / markdown modes).
//!
//! URI format: webproxy://fetch?url=<percent-encoded-url>&mode=<browser|reader|markdown>

use rusqlite::params;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::net::IpAddr;
use std::sync::atomic::{AtomicUsize, Ordering};
use tauri::http::{Request, Response};

use crate::AppState;

static ACTIVE_PROXY_REQUESTS: AtomicUsize = AtomicUsize::new(0);

// ── URL helpers ───────────────────────────────────────────────────────────────

/// Extract a named query parameter from a raw URI string.
fn query_param(uri: &str, key: &str) -> Option<String> {
    let query = uri.split_once('?')?.1;
    for part in query.split('&') {
        let mut kv = part.splitn(2, '=');
        let k = kv.next()?;
        if k == key {
            return Some(percent_decode(kv.next().unwrap_or("")));
        }
    }
    None
}

/// Percent-decode a URL-encoded string (%XX sequences and + → space).
fn percent_decode(s: &str) -> String {
    let raw = s.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(raw.len());
    let mut i = 0;
    while i < raw.len() {
        if raw[i] == b'%' && i + 2 < raw.len() {
            if let Ok(b) = u8::from_str_radix(&s[i + 1..i + 3], 16) {
                out.push(b);
                i += 3;
                continue;
            }
        } else if raw[i] == b'+' {
            out.push(b' ');
            i += 1;
            continue;
        }
        out.push(raw[i]);
        i += 1;
    }
    String::from_utf8(out).unwrap_or_else(|_| s.to_string())
}

#[derive(Debug, Clone)]
struct ProxySafety {
    allow_only_http_https: bool,
    disable_javascript: bool,
    redirect_recheck: bool,
    block_private_targets: bool,
    timeout_ms: u64,
    max_redirects: usize,
    max_response_bytes: usize,
    max_concurrency: usize,
}

impl Default for ProxySafety {
    fn default() -> Self {
        Self {
            allow_only_http_https: true,
            disable_javascript: true,
            redirect_recheck: true,
            // Keep local/private access enabled by default for local development workflows.
            block_private_targets: false,
            timeout_ms: 20_000,
            max_redirects: 5,
            max_response_bytes: 5_000_000,
            max_concurrency: 6,
        }
    }
}

fn parse_bool_query(uri: &str, key: &str, default_value: bool) -> bool {
    match query_param(uri, key).as_deref() {
        Some("1") | Some("true") | Some("yes") | Some("on") => true,
        Some("0") | Some("false") | Some("no") | Some("off") => false,
        _ => default_value,
    }
}

fn parse_u64_query(uri: &str, key: &str, default_value: u64, min: u64, max: u64) -> u64 {
    query_param(uri, key)
        .and_then(|v| v.parse::<u64>().ok())
        .map(|v| v.clamp(min, max))
        .unwrap_or(default_value)
}

fn parse_usize_query(uri: &str, key: &str, default_value: usize, min: usize, max: usize) -> usize {
    query_param(uri, key)
        .and_then(|v| v.parse::<usize>().ok())
        .map(|v| v.clamp(min, max))
        .unwrap_or(default_value)
}

fn parse_safety(uri: &str) -> ProxySafety {
    let mut cfg = ProxySafety::default();
    cfg.allow_only_http_https =
        parse_bool_query(uri, "allowHttpHttpsOnly", cfg.allow_only_http_https);
    cfg.disable_javascript = parse_bool_query(uri, "disableJavascript", cfg.disable_javascript);
    cfg.redirect_recheck = parse_bool_query(uri, "redirectRecheck", cfg.redirect_recheck);
    cfg.block_private_targets =
        parse_bool_query(uri, "blockPrivateTargets", cfg.block_private_targets);
    cfg.timeout_ms = parse_u64_query(uri, "timeoutMs", cfg.timeout_ms, 3_000, 120_000);
    cfg.max_redirects = parse_usize_query(uri, "maxRedirects", cfg.max_redirects, 0, 20);
    cfg.max_response_bytes = parse_usize_query(
        uri,
        "maxResponseBytes",
        cfg.max_response_bytes,
        100_000,
        25_000_000,
    );
    cfg.max_concurrency = parse_usize_query(uri, "maxConcurrency", cfg.max_concurrency, 1, 64);
    cfg
}

fn is_blocked_private_host(host: &str) -> bool {
    let h = host.trim().to_lowercase();
    if h.is_empty() {
        return true;
    }
    if h == "localhost" || h.ends_with(".local") {
        return true;
    }
    if let Ok(ip) = h.parse::<IpAddr>() {
        return match ip {
            IpAddr::V4(v4) => {
                let o = v4.octets();
                o[0] == 10
                    || o[0] == 127
                    || (o[0] == 169 && o[1] == 254)
                    || (o[0] == 172 && (16..=31).contains(&o[1]))
                    || (o[0] == 192 && o[1] == 168)
            }
            IpAddr::V6(v6) => {
                v6.is_loopback() || v6.is_unique_local() || v6.is_unicast_link_local()
            }
        };
    }
    false
}

fn validate_target_url(url: &str, cfg: &ProxySafety) -> Result<(), String> {
    let parsed = reqwest::Url::parse(url).map_err(|_| "Invalid target URL.".to_string())?;
    if cfg.allow_only_http_https {
        let scheme = parsed.scheme().to_ascii_lowercase();
        if scheme != "http" && scheme != "https" {
            return Err("Blocked URL scheme: only http/https are allowed.".to_string());
        }
    }
    if cfg.block_private_targets {
        let host = parsed
            .host_str()
            .ok_or_else(|| "URL host is missing.".to_string())?;
        if is_blocked_private_host(host) {
            return Err("Blocked private/local target host.".to_string());
        }
    }
    Ok(())
}

fn acquire_proxy_slot(limit: usize) -> bool {
    loop {
        let current = ACTIVE_PROXY_REQUESTS.load(Ordering::Relaxed);
        if current >= limit {
            return false;
        }
        if ACTIVE_PROXY_REQUESTS
            .compare_exchange(current, current + 1, Ordering::AcqRel, Ordering::Relaxed)
            .is_ok()
        {
            return true;
        }
    }
}

struct ProxySlotGuard;
impl Drop for ProxySlotGuard {
    fn drop(&mut self) {
        ACTIVE_PROXY_REQUESTS.fetch_sub(1, Ordering::AcqRel);
    }
}

// ── HTML helpers ──────────────────────────────────────────────────────────────

/// Inject `extra` immediately after the `<head>` opening tag (or at the top).
fn inject_after_head(html: &str, extra: &str) -> String {
    let lower = html.to_lowercase();
    let split = if let Some(pos) = lower.find("<head>") {
        pos + "<head>".len()
    } else if let Some(pos) = lower.find("<head ") {
        if let Some(end) = lower[pos..].find('>') {
            pos + end + 1
        } else {
            0
        }
    } else {
        0
    };
    if split > 0 {
        format!("{}{}{}", &html[..split], extra, &html[split..])
    } else {
        format!("{}{}", extra, html)
    }
}

/// Remove a block tag and all its contents, e.g. `<script>…</script>`.
fn remove_tag_blocks(html: &str, tag: &str) -> String {
    let open = format!("<{}", tag);
    let close = format!("</{}>", tag);
    let lower = html.to_lowercase();
    let mut out = String::new();
    let mut pos = 0;
    loop {
        match lower[pos..].find(&open) {
            None => {
                out.push_str(&html[pos..]);
                break;
            }
            Some(rel) => {
                let abs = pos + rel;
                out.push_str(&html[pos..abs]);
                match lower[abs..].find(&close) {
                    None => break, // malformed — stop
                    Some(end_rel) => pos = abs + end_rel + close.len(),
                }
            }
        }
    }
    out
}

/// Return the inner HTML of the first occurrence of `tag`, if found.
fn extract_inner(html: &str, tag: &str) -> Option<String> {
    let open = format!("<{}", tag);
    let close = format!("</{}>", tag);
    let lower = html.to_lowercase();
    let start = lower.find(&open)?;
    let tag_end = lower[start..].find('>')? + start + 1;
    let end = lower[tag_end..].find(&close)? + tag_end;
    Some(html[tag_end..end].to_string())
}

/// Strip all HTML tags from a string.
fn strip_tags(html: &str) -> String {
    let mut out = String::new();
    let mut in_tag = false;
    for ch in html.chars() {
        match ch {
            '<' => in_tag = true,
            '>' => in_tag = false,
            _ if !in_tag => out.push(ch),
            _ => {}
        }
    }
    out
}

/// Decode common HTML entities.
fn decode_entities(s: &str) -> String {
    s.replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&apos;", "'")
        .replace("&nbsp;", " ")
        .replace("&mdash;", "\u{2014}")
        .replace("&ndash;", "\u{2013}")
        .replace("&hellip;", "\u{2026}")
}

/// Replace opening and closing occurrences of `tag` with the given strings.
/// Handles `<tag>` and `<tag …>` (with attributes) for the opening variant.
fn tag_to_text(html: &str, tag: &str, open_rep: &str, close_rep: &str) -> String {
    let close_tag = format!("</{}>", tag);
    let open_prefix = format!("<{}", tag); // matches <tag> and <tag attr=...>

    // Replace closing tags first (case-sensitive match on lowercase HTML)
    let out = html.replace(&close_tag, close_rep);

    // Replace opening tags (scan for prefix then skip to closing '>')
    let lower = out.to_lowercase();
    let mut result = String::new();
    let mut pos = 0;
    loop {
        match lower[pos..].find(&open_prefix) {
            None => {
                result.push_str(&out[pos..]);
                break;
            }
            Some(rel) => {
                let abs = pos + rel;
                result.push_str(&out[pos..abs]);
                match out[abs..].find('>') {
                    None => {
                        result.push_str(&out[abs..]);
                        break;
                    }
                    Some(end_rel) => {
                        result.push_str(open_rep);
                        pos = abs + end_rel + 1;
                    }
                }
            }
        }
    }
    result
}

// ── Mode processors ───────────────────────────────────────────────────────────

/// Browser mode — strip original scripts (they break in the webproxy:// origin due to
/// CORS), inject a <base href> for relative URL resolution, then inject a lightweight
/// navigation interceptor that routes all link clicks and form submissions back through
/// the webproxy:// scheme instead of letting the iframe escape to direct HTTPS URLs.
fn browser_mode(html: &str, base_url: &str, disable_javascript: bool) -> Vec<u8> {
    let html = remove_tag_blocks(html, "script");
    let html = remove_tag_blocks(&html, "noscript");
    if disable_javascript {
        let head_inject = format!(r#"<base href="{base_url}">"#);
        return inject_after_head(&html, &head_inject).into_bytes();
    }

    // The interceptor must be injected AFTER stripping so it isn't removed itself.
    // It patches click and submit events to rewrite external navigations as
    // webproxy:// requests, keeping all browsing inside the proxy.
    let head_inject = format!(
        r#"<base href="{base_url}"><script>
(function(){{
  function proxyNav(href){{
    try{{
      var abs=new URL(href,document.baseURI).href;
      if(/^https?:\/\//.test(abs)){{
        window.parent.postMessage({{type:'webproxy:navigate',url:abs}},'*');
        window.location.href='webproxy://fetch?url='+encodeURIComponent(abs)+'&mode=browser';
      }}
    }}catch(e){{}}
  }}
  document.addEventListener('click',function(e){{
    var a=e.target.closest('a[href]');
    if(!a)return;
    var h=a.getAttribute('href');
    if(!h||h[0]==='#'||h.startsWith('javascript:'))return;
    e.preventDefault();
    proxyNav(h);
  }},true);
  document.addEventListener('submit',function(e){{
    var f=e.target;
    e.preventDefault();
    var action=f.getAttribute('action')||'';
    var m=(f.getAttribute('method')||'get').toLowerCase();
    if(m==='get'){{
      var p=new URLSearchParams(new FormData(f)).toString();
      proxyNav(action+(p?(action.includes('?')?'&':'?')+p:''));
    }}else{{
      proxyNav(action||window.location.href);
    }}
  }},true);
}})();
</script>"#
    );

    inject_after_head(&html, &head_inject).into_bytes()
}

/// Reader mode — remove noise (scripts, nav, ads), extract main content,
/// wrap in a clean readable stylesheet.
fn reader_mode(html: &str, base_url: &str) -> Vec<u8> {
    let c = remove_tag_blocks(html, "script");
    let c = remove_tag_blocks(&c, "style");
    let c = remove_tag_blocks(&c, "nav");
    let c = remove_tag_blocks(&c, "footer");
    let c = remove_tag_blocks(&c, "aside");
    let c = remove_tag_blocks(&c, "header");
    let c = remove_tag_blocks(&c, "form");
    let c = remove_tag_blocks(&c, "noscript");

    let content = extract_inner(&c, "article")
        .or_else(|| extract_inner(&c, "main"))
        .or_else(|| extract_inner(&c, "body"))
        .unwrap_or_else(|| c.clone());

    format!(
        r#"<!DOCTYPE html><html><head>
<meta charset="utf-8">
<base href="{base_url}">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
*{{box-sizing:border-box}}
body{{font-family:Georgia,serif;max-width:740px;margin:2rem auto;padding:0 1.5rem;
     color:#1a1a1a;background:#fefefe;line-height:1.8;font-size:17px}}
h1,h2,h3,h4,h5,h6{{font-weight:700;line-height:1.3;margin:1.5em 0 .5em;color:#111}}
p{{margin:.75em 0}}
img{{max-width:100%;height:auto;border-radius:4px}}
a{{color:#0055cc}}
pre{{overflow-x:auto;background:#f4f4f4;padding:1rem;border-radius:4px;font-size:13px}}
code{{background:#f4f4f4;padding:.15em .4em;border-radius:3px;font-size:13px}}
blockquote{{border-left:3px solid #ccc;margin:1em 0;padding-left:1rem;color:#555}}
table{{border-collapse:collapse;width:100%;margin:1em 0}}
td,th{{border:1px solid #ddd;padding:.5rem .75rem;text-align:left}}
</style>
</head><body>
{content}
</body></html>"#
    )
    .into_bytes()
}

/// Markdown mode — strip HTML, convert structural tags to markdown syntax,
/// return in a dark-themed <pre> for clean AI-readable display.
fn markdown_text(html: &str) -> String {
    let c = remove_tag_blocks(html, "script");
    let c = remove_tag_blocks(&c, "style");
    let c = remove_tag_blocks(&c, "nav");
    let c = remove_tag_blocks(&c, "footer");
    let c = remove_tag_blocks(&c, "aside");

    let body = extract_inner(&c, "body").unwrap_or_else(|| c.clone());

    // Block-level structural conversions (headings, paragraphs, lists)
    let md = tag_to_text(&body, "h1", "# ", "\n\n");
    let md = tag_to_text(&md, "h2", "## ", "\n\n");
    let md = tag_to_text(&md, "h3", "### ", "\n\n");
    let md = tag_to_text(&md, "h4", "#### ", "\n\n");
    let md = tag_to_text(&md, "h5", "##### ", "\n\n");
    let md = tag_to_text(&md, "h6", "###### ", "\n\n");
    let md = tag_to_text(&md, "p", "\n\n", "\n\n");
    let md = tag_to_text(&md, "li", "- ", "\n");
    let md = tag_to_text(&md, "blockquote", "\n> ", "\n\n");
    let md = tag_to_text(&md, "pre", "\n```\n", "\n```\n");

    // Inline formatting
    let md = md
        .replace("<strong>", "**")
        .replace("</strong>", "**")
        .replace("<b>", "**")
        .replace("</b>", "**")
        .replace("<em>", "*")
        .replace("</em>", "*")
        .replace("<i>", "*")
        .replace("</i>", "*")
        .replace("<code>", "`")
        .replace("</code>", "`")
        .replace("<br>", "\n")
        .replace("<br/>", "\n")
        .replace("<br />", "\n")
        .replace("<hr>", "\n---\n")
        .replace("<hr/>", "\n---\n");

    // Strip remaining tags and decode entities
    let md = strip_tags(&md);
    let md = decode_entities(&md);

    // Collapse runs of blank lines (max 2 consecutive)
    let mut text = String::new();
    let mut blanks = 0usize;
    for line in md.lines() {
        let t = line.trim();
        if t.is_empty() {
            blanks += 1;
            if blanks <= 2 {
                text.push('\n');
            }
        } else {
            blanks = 0;
            text.push_str(t);
            text.push('\n');
        }
    }
    text.trim().to_string()
}

fn markdown_mode(html: &str) -> Vec<u8> {
    let md_text = markdown_text(html);
    // Escape for HTML insertion
    let escaped = md_text
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;");

    format!(
        r#"<!DOCTYPE html><html><head>
<meta charset="utf-8">
<style>
body{{margin:0;padding:1.5rem 2rem;background:#111;color:#d4d4d4;
     font-family:'SF Mono',Consolas,'Liberation Mono',monospace;font-size:13px;
     line-height:1.7;white-space:pre-wrap;word-break:break-word}}
</style>
</head><body>{escaped}</body></html>"#
    )
    .into_bytes()
}

// ── Response helpers ──────────────────────────────────────────────────────────

fn build_response(status: u16, content_type: &str, body: Vec<u8>) -> Response<Vec<u8>> {
    Response::builder()
        .status(status)
        .header("Content-Type", content_type)
        .header("Access-Control-Allow-Origin", "*")
        .body(body)
        .unwrap_or_else(|_| {
            let mut r = Response::new(b"internal error".to_vec());
            *r.status_mut() = tauri::http::StatusCode::INTERNAL_SERVER_ERROR;
            r
        })
}

fn err_response(status: u16, msg: &str) -> Response<Vec<u8>> {
    let body = format!(
        "<!DOCTYPE html><html><body style='font-family:sans-serif;padding:2rem'>\
         <h2>Proxy Error {status}</h2><p>{msg}</p></body></html>"
    )
    .into_bytes();
    build_response(status, "text/html; charset=utf-8", body)
}

// ── Protocol handler ──────────────────────────────────────────────────────────

/// Handle a `webproxy://` URI scheme request. Registered in `lib.rs` via
/// `register_asynchronous_uri_scheme_protocol`.
pub async fn handle_proxy_request(request: Request<Vec<u8>>) -> Response<Vec<u8>> {
    let uri = request.uri().to_string();
    let safety = parse_safety(&uri);

    let target_url = match query_param(&uri, "url") {
        Some(u) if !u.is_empty() => u,
        _ => return err_response(400, "Missing <code>url</code> query parameter."),
    };
    if let Err(msg) = validate_target_url(&target_url, &safety) {
        return err_response(400, &msg);
    }
    let mode = query_param(&uri, "mode").unwrap_or_else(|| "browser".to_string());
    if !acquire_proxy_slot(safety.max_concurrency) {
        return err_response(429, "Too many concurrent browser requests.");
    }
    let _slot_guard = ProxySlotGuard;

    let redirect_policy = if safety.redirect_recheck {
        let safety_for_redirect = safety.clone();
        reqwest::redirect::Policy::custom(move |attempt| {
            if attempt.previous().len() >= safety_for_redirect.max_redirects {
                return attempt.error("redirect limit exceeded");
            }
            let next = attempt.url().to_string();
            if let Err(msg) = validate_target_url(&next, &safety_for_redirect) {
                return attempt.error(msg);
            }
            attempt.follow()
        })
    } else {
        reqwest::redirect::Policy::limited(safety.max_redirects)
    };

    let client = match reqwest::Client::builder()
        .user_agent(
            "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 \
             (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        )
        .timeout(std::time::Duration::from_millis(safety.timeout_ms))
        .redirect(redirect_policy)
        .build()
    {
        Ok(c) => c,
        Err(e) => return err_response(500, &format!("HTTP client error: {e}")),
    };

    let mut resp = match client.get(&target_url).send().await {
        Ok(r) => r,
        Err(e) => return err_response(502, &format!("Fetch failed: {e}")),
    };

    let status = resp.status().as_u16();
    let content_type = resp
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("application/octet-stream")
        .to_string();

    let mut body: Vec<u8> = Vec::new();
    loop {
        match resp.chunk().await {
            Ok(Some(chunk)) => {
                if body.len().saturating_add(chunk.len()) > safety.max_response_bytes {
                    return err_response(413, "Response exceeds configured max size.");
                }
                body.extend_from_slice(&chunk);
            }
            Ok(None) => break,
            Err(e) => return err_response(502, &format!("Body read error: {e}")),
        }
    }

    if content_type.contains("text/html") {
        let html = String::from_utf8_lossy(&body);
        let (ct, body) = match mode.as_str() {
            "reader" => ("text/html; charset=utf-8", reader_mode(&html, &target_url)),
            "markdown" => ("text/html; charset=utf-8", markdown_mode(&html)),
            _ => (
                "text/html; charset=utf-8",
                browser_mode(&html, &target_url, safety.disable_javascript),
            ),
        };
        build_response(status, ct, body)
    } else {
        // Non-HTML (CSS, images, fonts, JS subresources) — pass through unchanged
        build_response(status, &content_type, body)
    }
}

// ── Tauri command for AI agent ────────────────────────────────────────────────

/// Fetch a URL and return its content for AI agent access.
///
/// `mode`:
/// - `"html"`     — raw HTML
/// - `"text"`     — plain text (all tags stripped)
/// - `"markdown"` — markdown-like representation (default)
#[tauri::command]
pub async fn cmd_browser_fetch(url: String, mode: Option<String>) -> Result<String, String> {
    let safety = ProxySafety::default();
    validate_target_url(&url, &safety)?;
    let safety_for_redirect = safety.clone();
    let client = reqwest::Client::builder()
        .user_agent(
            "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 \
             (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        )
        .timeout(std::time::Duration::from_millis(safety.timeout_ms))
        .redirect(reqwest::redirect::Policy::custom(move |attempt| {
            if attempt.previous().len() >= safety_for_redirect.max_redirects {
                return attempt.error("redirect limit exceeded");
            }
            let next = attempt.url().to_string();
            if let Err(msg) = validate_target_url(&next, &safety_for_redirect) {
                return attempt.error(msg);
            }
            attempt.follow()
        }))
        .build()
        .map_err(|e| e.to_string())?;

    let mut resp = client.get(&url).send().await.map_err(|e| e.to_string())?;
    let mut body: Vec<u8> = Vec::new();
    loop {
        match resp.chunk().await {
            Ok(Some(chunk)) => {
                if body.len().saturating_add(chunk.len()) > safety.max_response_bytes {
                    return Err("Response exceeds max size limit.".to_string());
                }
                body.extend_from_slice(&chunk);
            }
            Ok(None) => break,
            Err(e) => return Err(e.to_string()),
        }
    }
    let html = String::from_utf8_lossy(&body).to_string();

    Ok(match mode.as_deref().unwrap_or("markdown") {
        "html" => html,
        "text" => {
            let c = remove_tag_blocks(&html, "script");
            let c = remove_tag_blocks(&c, "style");
            let c = strip_tags(&c);
            let c = decode_entities(&c);
            // Collapse whitespace
            c.lines()
                .map(|l| l.trim())
                .filter(|l| !l.is_empty())
                .collect::<Vec<_>>()
                .join("\n")
        }
        _ => markdown_text(&html),
    })
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SerperSearchResult {
    pub query: String,
    pub mode: String,
    pub items: Vec<serde_json::Value>,
    pub organic: Vec<serde_json::Value>,
    pub answer_box: Option<serde_json::Value>,
    pub knowledge_graph: Option<serde_json::Value>,
    pub people_also_ask: Vec<serde_json::Value>,
    pub related_searches: Vec<String>,
    pub raw: serde_json::Value,
}

fn db_get_setting(state: &AppState, key: &str) -> Result<Option<String>, String> {
    let db = state.db.lock().unwrap();
    let result = db.query_row(
        "SELECT value FROM settings WHERE key = ?1",
        params![key],
        |row| row.get::<_, String>(0),
    );
    match result {
        Ok(value) => Ok(Some(value)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

fn db_set_setting(state: &AppState, key: &str, value: &str) -> Result<(), String> {
    let db = state.db.lock().unwrap();
    db.execute(
        "INSERT OR REPLACE INTO settings (key, value) VALUES (?1, ?2)",
        params![key, value],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn serper_key_status(state: &AppState) -> Result<serde_json::Value, String> {
    let key = db_get_setting(state, "serper_api_key")?.unwrap_or_default();
    let trimmed = key.trim();
    let configured = !trimmed.is_empty();
    let masked = if configured {
        if trimmed.len() <= 8 {
            "****".to_string()
        } else {
            format!(
                "{}****{}",
                &trimmed[..4],
                &trimmed[trimmed.len().saturating_sub(4)..]
            )
        }
    } else {
        "".to_string()
    };
    Ok(json!({
        "configured": configured,
        "masked": masked,
    }))
}

pub fn serper_key_set(state: &AppState, api_key: String) -> Result<(), String> {
    db_set_setting(state, "serper_api_key", api_key.trim())
}

pub async fn serper_key_test(state: &AppState) -> Result<serde_json::Value, String> {
    let key = db_get_setting(state, "serper_api_key")?.unwrap_or_default();
    let key = key.trim().to_string();
    if key.is_empty() {
        return Ok(json!({
            "ok": false,
            "status": null,
            "message": "Serper API key is not configured.",
        }));
    }
    serper_test_key(key).await
}

pub async fn serper_key_validate(api_key: String) -> Result<serde_json::Value, String> {
    let key = api_key.trim().to_string();
    if key.is_empty() {
        return Ok(json!({
            "ok": false,
            "status": null,
            "message": "Enter an API key.",
        }));
    }
    serper_test_key(key).await
}

async fn serper_test_key(key: String) -> Result<serde_json::Value, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(12))
        .build()
        .map_err(|e| e.to_string())?;

    let resp = client
        .post("https://google.serper.dev/search")
        .header("X-API-KEY", key)
        .header("Content-Type", "application/json")
        .json(&json!({ "q": "test" }))
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let status = resp.status().as_u16();
    let ok = resp.status().is_success();
    let body = resp.text().await.unwrap_or_default();
    let message = if ok {
        "Connected"
    } else if status == 401 || status == 403 {
        "Invalid API key"
    } else {
        "Serper request failed"
    };

    Ok(json!({
        "ok": ok,
        "status": status,
        "message": message,
        "detail": body,
    }))
}

pub async fn serper_search(
    state: &AppState,
    query: String,
    mode: Option<String>,
    num: Option<u32>,
    page: Option<u32>,
) -> Result<SerperSearchResult, String> {
    let q = query.trim().to_string();
    if q.is_empty() {
        return Err("Search query cannot be empty.".to_string());
    }

    let key = db_get_setting(state, "serper_api_key")?.unwrap_or_default();
    let key = key.trim().to_string();
    if key.is_empty() {
        return Err("Serper API key is not configured.".to_string());
    }

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .build()
        .map_err(|e| e.to_string())?;

    let requested_mode = mode
        .unwrap_or_else(|| "search".to_string())
        .trim()
        .to_lowercase();
    let normalized_mode = match requested_mode.as_str() {
        "search" => "search",
        "images" => "images",
        "news" => "news",
        "maps" => "maps",
        "places" => "places",
        "videos" => "videos",
        "shopping" => "shopping",
        "scholar" => "scholar",
        _ => "search",
    };
    let endpoint = format!("https://google.serper.dev/{}", normalized_mode);

    let mut payload = json!({
        "q": q,
    });
    if let Some(n) = num {
        payload["num"] = json!(n.clamp(1, 20));
    }
    if let Some(p) = page {
        payload["page"] = json!(p.max(1));
    }

    let resp = client
        .post(endpoint)
        .header("X-API-KEY", key)
        .header("Content-Type", "application/json")
        .json(&payload)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let status = resp.status();
    let body = resp.text().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(format!(
            "Serper search failed (HTTP {}): {}",
            status.as_u16(),
            body
        ));
    }

    let parsed: serde_json::Value = serde_json::from_str(&body).map_err(|e| e.to_string())?;
    let items = parsed
        .get(match normalized_mode {
            "images" => "images",
            "news" => "news",
            "videos" => "videos",
            "shopping" => "shopping",
            "places" => "places",
            "maps" => "places",
            "scholar" => "organic",
            _ => "organic",
        })
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();
    let organic = parsed
        .get("organic")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();
    let people_also_ask = parsed
        .get("peopleAlsoAsk")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();
    let related_searches = parsed
        .get("relatedSearches")
        .and_then(|v| v.as_array())
        .map(|items| {
            items
                .iter()
                .filter_map(|item| {
                    item.get("query")
                        .and_then(|q| q.as_str())
                        .map(|q| q.to_string())
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    Ok(SerperSearchResult {
        query: query.trim().to_string(),
        mode: normalized_mode.to_string(),
        items,
        organic,
        answer_box: parsed.get("answerBox").cloned(),
        knowledge_graph: parsed.get("knowledgeGraph").cloned(),
        people_also_ask,
        related_searches,
        raw: parsed,
    })
}

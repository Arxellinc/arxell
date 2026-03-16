pub mod models;

use anyhow::Result;
use rusqlite::Connection;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use uuid::Uuid;

/// Generates a short project ID: "P" followed by 5 uppercase alphanumeric characters.
/// Uses UUID v4 bytes as entropy so no additional rand dependency is needed.
pub(crate) fn gen_project_id() -> String {
    const ALPHA: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    let bytes = Uuid::new_v4().into_bytes();
    let mut id = String::with_capacity(6);
    id.push('P');
    for &b in &bytes[..5] {
        id.push(ALPHA[(b as usize) % ALPHA.len()] as char);
    }
    id
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn user_home_dir() -> Option<PathBuf> {
    std::env::var("HOME")
        .ok()
        .map(PathBuf::from)
        .or_else(|| std::env::var("USERPROFILE").ok().map(PathBuf::from))
}

fn default_projects_root() -> PathBuf {
    let mut base = user_home_dir()
        .unwrap_or_else(|| std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")));
    base.push("Documents");
    base.push("Arxell");
    base.push("Projects");
    base
}

fn sanitize_project_segment(name: &str) -> String {
    let mut out = String::new();
    let mut prev_dash = false;
    for ch in name.trim().chars() {
        let keep = ch.is_ascii_alphanumeric() || ch == '-' || ch == '_';
        if keep {
            out.push(ch);
            prev_dash = false;
        } else if !prev_dash {
            out.push('-');
            prev_dash = true;
        }
    }
    let trimmed = out.trim_matches('-').to_string();
    if trimmed.is_empty() {
        "project".to_string()
    } else {
        trimmed
    }
}

fn default_workspace_for_project(project_name: &str, project_id: &str) -> PathBuf {
    let mut path = default_projects_root();
    let slug = sanitize_project_segment(project_name);
    path.push(format!("{slug}-{project_id}"));
    path
}

fn ensure_workspace_dir(path: &Path) -> Result<String> {
    std::fs::create_dir_all(path)?;
    let canonical = std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
    Ok(canonical.to_string_lossy().to_string())
}

fn ensure_general_project(conn: &Connection) -> Result<String> {
    let existing = conn.query_row(
        "SELECT id, workspace_path FROM projects WHERE lower(trim(name)) = 'general' ORDER BY updated_at DESC LIMIT 1",
        [],
        |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
    );
    if let Ok((id, workspace_path)) = existing {
        if workspace_path.trim().is_empty() {
            let default_path =
                ensure_workspace_dir(&default_workspace_for_project("General", &id))?;
            conn.execute(
                "UPDATE projects SET workspace_path = ?1, updated_at = ?2 WHERE id = ?3",
                rusqlite::params![default_path, now_ms(), id],
            )?;
        } else {
            let canonical = ensure_workspace_dir(Path::new(workspace_path.trim()))?;
            if canonical != workspace_path {
                conn.execute(
                    "UPDATE projects SET workspace_path = ?1, updated_at = ?2 WHERE id = ?3",
                    rusqlite::params![canonical, now_ms(), id],
                )?;
            }
        }
        return Ok(id);
    }

    let id = gen_project_id();
    let now = now_ms();
    let workspace_path = ensure_workspace_dir(&default_workspace_for_project("General", &id))?;
    conn.execute(
        "INSERT INTO projects (id, name, description, workspace_path, created_at, updated_at) VALUES (?1, 'General', '', ?2, ?3, ?3)",
        rusqlite::params![id, workspace_path, now],
    )?;
    Ok(id)
}

pub fn init_db(path: &Path) -> Result<Connection> {
    let conn = Connection::open(path)?;

    conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")?;

    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS projects (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            description TEXT NOT NULL DEFAULT '',
            workspace_path TEXT NOT NULL DEFAULT '',
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS conversations (
            id TEXT PRIMARY KEY,
            project_id TEXT,
            title TEXT NOT NULL DEFAULT 'New Chat',
            model TEXT NOT NULL DEFAULT '',
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL
        );

        CREATE TABLE IF NOT EXISTS messages (
            id TEXT PRIMARY KEY,
            conversation_id TEXT NOT NULL,
            role TEXT NOT NULL,
            content TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS model_configs (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            api_type TEXT NOT NULL DEFAULT 'chat',
            model_id TEXT NOT NULL,
            base_url TEXT NOT NULL,
            api_key TEXT NOT NULL DEFAULT '',
            parameter_count INTEGER,
            speed_tps REAL,
            context_length INTEGER,
            monthly_cost REAL,
            cost_per_million_tokens REAL,
            last_available INTEGER NOT NULL DEFAULT 0,
            last_check_message TEXT NOT NULL DEFAULT '',
            last_check_at INTEGER,
            is_primary INTEGER NOT NULL DEFAULT 0,
            created_at INTEGER NOT NULL
        );

        INSERT OR IGNORE INTO settings (key, value) VALUES
            ('base_url', 'http://127.0.0.1:1234/v1'),
            ('api_key', 'lm-studio'),
            ('model', 'zai-org/glm-4.6v-flash'),
            ('stt_url', 'http://127.0.0.1:1234/v1/audio/transcriptions'),
            ('stt_engine', 'whisper_rs'),
            ('whisper_model_size', 'tiny'),
            ('whisper_model_dir', ''),
            ('whisper_rs_model_path', ''),
            ('whisper_rs_language', 'en'),
            ('tts_url', 'http://127.0.0.1:1234/v1/audio/speech'),
            ('tts_voice', 'alloy'),
            ('tts_engine', 'kokoro'),
            ('kokoro_model_path', ''),
            ('kokoro_voices_path', ''),
            ('kokoro_voice', 'af_heart'),
            ('vad_threshold', '0.35'),
            ('vad_min_silence_ms', '1100'),
            ('vad_speech_pad_pre_ms', '320'),
            ('vad_min_speech_ms', '50'),
            ('vad_max_speech_s', '30.0'),
            ('vad_amplitude_threshold', '0.005'),
            ('vad_mode', 'auto'),
            ('system_prompt', 'You are Arxell, a helpful AI assistant. Be concise and clear.'),
            ('prefill_enabled', 'true'),
            ('barge_in_enabled', 'true'),
            ('stable_tail_words', '6'),
            ('prefill_min_words', '3'),
            ('prefill_divergence_threshold', '0.8');
        "#,
    )?;

    // Migration: update VAD defaults that shipped at suboptimal values
    conn.execute_batch(
        r#"
        UPDATE settings SET value = '0.35'  WHERE key = 'vad_threshold'         AND value = '0.5';
        UPDATE settings SET value = '1100'  WHERE key = 'vad_min_silence_ms'     AND value = '640';
        UPDATE settings SET value = '1100'  WHERE key = 'vad_min_silence_ms'     AND value = '1200';
        UPDATE settings SET value = 'whisper_rs'
            WHERE key = 'stt_engine' AND value = 'whisper';
        UPDATE settings SET value = ''
            WHERE key = 'whisper_rs_model_path' AND value IN (
                '~/.local/share/arx/whisper/ggml-base.en.bin',
                '~/.local/share/arx/whisper/ggml-base-q8_0.bin',
                '~/.local/share/arxell/whisper/ggml-base.en.bin'
            );
        UPDATE settings SET value = ''
            WHERE key = 'kokoro_model_path' AND value = '~/.local/share/arx/kokoro/kokoro-v1.0.onnx';
        UPDATE settings SET value = ''
            WHERE key = 'kokoro_model_path' AND value = '~/.local/share/arx/kokoro/model.onnx';
        UPDATE settings SET value = ''
            WHERE key = 'kokoro_model_path' AND value = '~/.local/share/arx/kokoro/model_quantized.onnx';
        UPDATE settings SET value = ''
            WHERE key = 'kokoro_voices_path' AND value = '~/.local/share/arx/kokoro/voices-v1.0.bin';
        UPDATE settings SET value = '320'   WHERE key = 'vad_speech_pad_pre_ms'  AND value = '100';
        UPDATE settings SET value = '320'   WHERE key = 'vad_speech_pad_pre_ms'  AND value = '150';
        UPDATE settings SET value = '50'    WHERE key = 'vad_min_speech_ms'      AND value = '100';
        "#,
    )?;

    // Migration: model_configs optional metadata + availability tracking fields
    let _ = conn.execute(
        "ALTER TABLE model_configs ADD COLUMN api_type TEXT NOT NULL DEFAULT 'chat'",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE model_configs ADD COLUMN parameter_count INTEGER",
        [],
    );
    let _ = conn.execute("ALTER TABLE model_configs ADD COLUMN speed_tps REAL", []);
    let _ = conn.execute(
        "ALTER TABLE model_configs ADD COLUMN context_length INTEGER",
        [],
    );
    let _ = conn.execute("ALTER TABLE model_configs ADD COLUMN monthly_cost REAL", []);
    let _ = conn.execute(
        "ALTER TABLE model_configs ADD COLUMN cost_per_million_tokens REAL",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE model_configs ADD COLUMN last_available INTEGER NOT NULL DEFAULT 0",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE model_configs ADD COLUMN last_check_message TEXT NOT NULL DEFAULT ''",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE model_configs ADD COLUMN last_check_at INTEGER",
        [],
    );

    // Migration: espeak was the original TTS engine before Kokoro support was added.
    // Silently upgrade existing installs to Kokoro (local, high quality, no server needed).
    conn.execute_batch(
        r#"
        -- Migrate legacy engines to kokoro (catch-all: any unrecognised engine → kokoro)
        UPDATE settings SET value = 'kokoro' WHERE key = 'tts_engine' AND value NOT IN ('kokoro', 'external');

        -- Ensure kokoro paths exist
        INSERT OR IGNORE INTO settings (key, value) VALUES
            ('kokoro_model_path',      ''),
            ('kokoro_voices_path',     ''),
            ('kokoro_voice',           'af_heart'),
            ('whisper_rs_model_path',  ''),
            ('whisper_rs_language',    'en');

        -- Remove obsolete piper / kitten / index_tts keys
        DELETE FROM settings WHERE key IN (
            'tts_piper_binary', 'tts_piper_model',
            'tts_kitten_binary', 'tts_kitten_model', 'tts_kitten_voice', 'tts_kitten_args',
            'tts_index_binary', 'tts_index_model', 'tts_index_voice', 'tts_index_args',
            'kokoro_int8_model_path', 'kokoro_int8_voices_path'
        );
        "#,
    )?;

    // Data normalization: ensure a real "General" project exists and repair orphan/unassigned conversations.
    let general_project_id = ensure_general_project(&conn)?;
    conn.execute(
        "UPDATE conversations SET project_id = ?1
         WHERE project_id IS NULL
            OR trim(project_id) = ''
            OR project_id NOT IN (SELECT id FROM projects)",
        rusqlite::params![general_project_id],
    )?;

    crate::a2a::store::init_schema(&conn)?;
    crate::memory::init_schema(&conn)?;

    Ok(conn)
}

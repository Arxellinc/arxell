//! Explicit user-saved memory. Mail/tool output is never automatically ingested.
use rusqlite::{params, Connection};
use std::path::PathBuf;
use std::sync::Mutex;

pub trait MemoryManager: Send + Sync {
    fn upsert(&self, namespace: &str, key: &str, value: &str) -> Result<(), String>;
    fn delete(&self, namespace: &str, key: &str) -> Result<bool, String>;
    fn list_namespace(&self, namespace: &str) -> Result<Vec<(String, String)>, String>;
}

pub struct SqliteMemoryManager {
    connection: Mutex<Connection>,
}

impl SqliteMemoryManager {
    pub fn new(path: PathBuf) -> Result<Self, String> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|_| "failed creating memory directory")?;
        }
        let conn = Connection::open(path).map_err(|_| "failed opening memory database")?;
        conn.busy_timeout(std::time::Duration::from_secs(5))
            .map_err(|_| "failed configuring memory database")?;
        conn.execute_batch(
            "PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS saved_memory (
            namespace TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL,
            PRIMARY KEY(namespace, key));",
        )
        .map_err(|_| "failed initializing memory database")?;
        Ok(Self {
            connection: Mutex::new(conn),
        })
    }
}

impl MemoryManager for SqliteMemoryManager {
    fn upsert(&self, namespace: &str, key: &str, value: &str) -> Result<(), String> {
        if namespace.is_empty()
            || namespace.len() > 64
            || key.trim().is_empty()
            || key.len() > 256
            || value.len() > 16_384
        {
            return Err("memory requires a namespace, a nonempty key (max 256 bytes), and a value no larger than 16 KiB".into());
        }
        let conn = self
            .connection
            .lock()
            .map_err(|_| "memory database lock unavailable")?;
        conn.execute(
            "INSERT INTO saved_memory(namespace,key,value) VALUES(?1,?2,?3)
            ON CONFLICT(namespace,key) DO UPDATE SET value=excluded.value",
            params![namespace, key, value],
        )
        .map_err(|_| "failed saving memory")?;
        Ok(())
    }
    fn delete(&self, namespace: &str, key: &str) -> Result<bool, String> {
        let conn = self
            .connection
            .lock()
            .map_err(|_| "memory database lock unavailable")?;
        // Secure deletion applies to the active SQLite database; external backups remain user-owned.
        conn.execute_batch("PRAGMA secure_delete=ON;")
            .map_err(|_| "failed configuring memory deletion")?;
        let deleted = conn
            .execute(
                "DELETE FROM saved_memory WHERE namespace=?1 AND key=?2",
                params![namespace, key],
            )
            .map_err(|_| "failed deleting memory")?
            > 0;
        conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);")
            .map_err(|_| "failed checkpointing memory deletion")?;
        Ok(deleted)
    }
    fn list_namespace(&self, namespace: &str) -> Result<Vec<(String, String)>, String> {
        let conn = self
            .connection
            .lock()
            .map_err(|_| "memory database lock unavailable")?;
        let mut stmt = conn
            .prepare("SELECT key,value FROM saved_memory WHERE namespace=?1 ORDER BY key")
            .map_err(|_| "failed reading memory")?;
        let rows = stmt
            .query_map([namespace], |row| Ok((row.get(0)?, row.get(1)?)))
            .map_err(|_| "failed reading memory")?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|_| "failed reading memory".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn explicit_memory_survives_restart_and_deletion() {
        let root = std::env::temp_dir().join(format!("arxell-memory-{}", uuid::Uuid::new_v4()));
        let path = root.join("memory.sqlite3");
        {
            let memory = SqliteMemoryManager::new(path.clone()).unwrap();
            memory.upsert("user", "hours", "09:00–17:00").unwrap();
            memory
                .upsert("custom-context", "format", "Brief answers")
                .unwrap();
        }
        {
            let memory = SqliteMemoryManager::new(path.clone()).unwrap();
            assert_eq!(
                memory.list_namespace("user").unwrap(),
                vec![("hours".into(), "09:00–17:00".into())]
            );
            assert!(memory.delete("user", "hours").unwrap());
            assert!(!memory.delete("user", "missing").unwrap());
        }
        let memory = SqliteMemoryManager::new(path).unwrap();
        assert!(memory.list_namespace("user").unwrap().is_empty());
        assert_eq!(memory.list_namespace("custom-context").unwrap().len(), 1);
        drop(memory);
        std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn invalid_saves_return_errors_instead_of_success() {
        let memory = SqliteMemoryManager {
            connection: Mutex::new(Connection::open_in_memory().unwrap()),
        };
        assert!(memory.upsert("user", "", "value").is_err());
        assert!(memory.upsert("user", "key", &"x".repeat(16_385)).is_err());
        assert!(memory
            .upsert("user", "key", "database has no schema")
            .is_err());
    }
}

use std::collections::HashMap;
use std::sync::{Arc, RwLock};

pub trait MemoryManager: Send + Sync {
    fn upsert(&self, namespace: &str, key: &str, value: &str);
    fn delete(&self, namespace: &str, key: &str) -> bool;
    fn list_namespace(&self, namespace: &str) -> Vec<(String, String)>;
}

#[derive(Default)]
pub struct InMemoryMemoryManager {
    inner: Arc<RwLock<HashMap<String, HashMap<String, String>>>>,
}

impl InMemoryMemoryManager {
    pub fn new() -> Self {
        Self::default()
    }
}

impl MemoryManager for InMemoryMemoryManager {
    fn upsert(&self, namespace: &str, key: &str, value: &str) {
        let mut guard = self.inner.write().expect("memory write lock poisoned");
        let ns = guard.entry(namespace.to_string()).or_default();
        ns.insert(key.to_string(), value.to_string());
    }

    fn delete(&self, namespace: &str, key: &str) -> bool {
        let mut guard = self.inner.write().expect("memory write lock poisoned");
        let Some(ns) = guard.get_mut(namespace) else {
            return false;
        };
        ns.remove(key).is_some()
    }

    fn list_namespace(&self, namespace: &str) -> Vec<(String, String)> {
        let guard = self.inner.read().expect("memory read lock poisoned");
        guard
            .get(namespace)
            .map(|ns| ns.iter().map(|(k, v)| (k.clone(), v.clone())).collect())
            .unwrap_or_default()
    }
}

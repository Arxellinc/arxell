//! One selection/rendering path for saved context and the context inspector.
use crate::contracts::ChatContextBreakdownItem;
use crate::memory::MemoryManager;

const SAVED_CONTEXT_BUDGET: usize = 32_768;

/// Only noncredential metadata is eligible for a prompt or context inspection.
pub fn api_registry_context(records: &[crate::contracts::ApiConnectionRecord]) -> Option<String> {
    let mut lines = Vec::new();
    for record in records
        .iter()
        .filter(|record| record.status == crate::contracts::ApiConnectionStatus::Verified)
    {
        let kind = match record.api_type {
            crate::contracts::ApiConnectionType::Llm => "LLM",
            crate::contracts::ApiConnectionType::Search => "Search",
            crate::contracts::ApiConnectionType::Stt => "STT",
            crate::contracts::ApiConnectionType::Tts => "TTS",
            crate::contracts::ApiConnectionType::Image => "Image",
            crate::contracts::ApiConnectionType::Other => "Other",
        };
        lines.push(format!(
            "- type={kind}, name={}",
            record.name.as_deref().unwrap_or("(unnamed)")
        ));
    }
    if lines.is_empty() {
        None
    } else {
        Some(format!(
            "Verified API connections available to backend tools:\n{}",
            lines.join("\n")
        ))
    }
}

pub fn saved_context(memory: &dyn MemoryManager) -> Result<Vec<ChatContextBreakdownItem>, String> {
    let mut items = Vec::new();
    let mut remaining = SAVED_CONTEXT_BUDGET;
    for namespace in [
        "directive",
        "custom-context",
        "user",
        "fact",
        "personality",
        "other",
    ] {
        for (key, value) in memory.list_namespace(namespace)? {
            // Context keys stay editable through the existing custom-item IPC contract.
            let key = if namespace == "custom-context" {
                key
            } else {
                format!("{namespace}:{key}")
            };
            let cost = key.len() + value.len() + 8;
            let selected = cost <= remaining;
            if selected {
                remaining -= cost;
            }
            items.push(ChatContextBreakdownItem {
                section: if namespace == "custom-context" {
                    "context"
                } else {
                    "memory"
                }
                .into(),
                category: namespace.into(),
                key,
                source_path: None,
                load_method: if selected { "default" } else { "dynamic" }.into(),
                load_reason: if selected {
                    "user_saved"
                } else {
                    "context_budget"
                }
                .into(),
                token_estimate: ((value.chars().count() + 3) / 4) as i64,
                char_count: value.chars().count(),
                word_count: value.split_whitespace().count(),
                value,
            });
        }
    }
    Ok(items)
}

pub fn render_context(items: &[ChatContextBreakdownItem]) -> String {
    items
        .iter()
        .filter(|item| item.load_method == "default")
        .map(|item| format!("## {}\n{}", item.key, item.value))
        .collect::<Vec<_>>()
        .join("\n\n")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::memory::SqliteMemoryManager;
    #[test]
    fn api_context_does_not_expose_credentials_or_authenticated_urls() {
        let record = crate::contracts::ApiConnectionRecord {
            id: "fixture".into(),
            api_type: crate::contracts::ApiConnectionType::Search,
            name: Some("Search service".into()),
            api_url: "https://private-token@example.invalid/?key=private-token".into(),
            api_key_prefix: "private-token".into(),
            api_key_masked: "private-token".into(),
            model_name: None,
            cost_per_month_usd: None,
            status: crate::contracts::ApiConnectionStatus::Verified,
            status_message: "private-token".into(),
            last_checked_ms: None,
            created_ms: 0,
            api_standard_path: None,
            available_models: Vec::new(),
        };
        let context = api_registry_context(&[record]).unwrap();
        assert!(context.contains("Search service"));
        assert!(!context.contains("private-token"));
        assert!(!context.contains("example.invalid"));
    }

    #[test]
    fn rendered_prompt_uses_exactly_the_inspectors_selected_saved_entries() {
        let root = std::env::temp_dir().join(format!("arxell-context-{}", uuid::Uuid::new_v4()));
        let memory = SqliteMemoryManager::new(root.join("memory.sqlite3")).unwrap();
        memory
            .upsert("directive", "brief", "Use concise answers")
            .unwrap();
        memory.upsert("user", "hours", "09:00–17:00").unwrap();
        for i in 0..5 {
            memory
                .upsert("fact", &format!("large-{i}"), &"x".repeat(16_000))
                .unwrap();
        }
        let items = saved_context(&memory).unwrap();
        let prompt = render_context(&items);
        for item in &items {
            assert_eq!(
                prompt.contains(&format!("## {}\n", item.key)),
                item.load_method == "default"
            );
        }
        assert!(items
            .iter()
            .any(|item| item.load_reason == "context_budget"));
        memory.delete("user", "hours").unwrap();
        assert!(!render_context(&saved_context(&memory).unwrap()).contains("09:00–17:00"));
        drop(memory);
        std::fs::remove_dir_all(root).unwrap();
    }
}

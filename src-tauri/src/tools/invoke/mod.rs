#![cfg(feature = "tauri-runtime")]

pub mod files;
pub mod flow;
pub mod looper;
pub mod registry;
pub mod sheets;
pub mod web_search;

use registry::InvokeRegistry;

pub fn build_registry() -> InvokeRegistry {
    let mut registry = InvokeRegistry::new();
    flow::register(&mut registry);
    files::register(&mut registry);
    looper::register(&mut registry);
    sheets::register(&mut registry);
    web_search::register(&mut registry);
    registry
}

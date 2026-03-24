fn main() {
    if std::env::var("CARGO_FEATURE_TAURI_RUNTIME").is_ok() {
        tauri_build::build();
    }
}

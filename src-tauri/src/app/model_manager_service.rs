use crate::contracts::{
    EventSeverity, EventStage, ModelManagerCatalogCsvRow, ModelManagerHfCandidate,
    ModelManagerInstalledModel, Subsystem,
};
use crate::observability::EventHub;
use serde::Deserialize;
use serde_json::json;
use std::fs::File;
use std::io::Write;
use std::path::{Path, PathBuf};

#[derive(Debug, Deserialize)]
struct HfSearchItem {
    id: String,
}

#[derive(Debug, Deserialize)]
struct HfModelDetail {
    siblings: Option<Vec<HfSibling>>,
}

#[derive(Debug, Deserialize)]
struct HfSibling {
    rfilename: String,
    size: Option<u64>,
}

#[derive(Debug, Clone)]
struct BestAsset {
    repo_id: String,
    file_name: String,
    size_bytes: Option<u64>,
}

#[derive(Clone)]
pub struct ModelManagerService {
    hub: EventHub,
}

impl ModelManagerService {
    pub fn new(hub: EventHub) -> Self {
        Self { hub }
    }

    pub fn list_installed(
        &self,
        correlation_id: &str,
        app_data_dir: &Path,
    ) -> Result<Vec<ModelManagerInstalledModel>, String> {
        self.emit(
            correlation_id,
            "model.manager.list_installed",
            EventStage::Start,
            EventSeverity::Info,
            json!({}),
        );

        let models_dir = ensure_models_dir(app_data_dir)?;
        let mut out = Vec::new();
        let read_dir = std::fs::read_dir(&models_dir)
            .map_err(|e| format!("failed to read models directory: {e}"))?;

        for entry in read_dir.flatten() {
            let path = entry.path();
            if !is_gguf(&path) {
                continue;
            }
            let Ok(metadata) = entry.metadata() else {
                continue;
            };
            let name = path
                .file_name()
                .and_then(|s| s.to_str())
                .unwrap_or("unknown.gguf")
                .to_string();
            let modified_ms = metadata
                .modified()
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as i64)
                .unwrap_or(0);
            out.push(ModelManagerInstalledModel {
                id: name.clone(),
                name,
                path: path.to_string_lossy().to_string(),
                size_mb: metadata.len() / (1024 * 1024),
                modified_ms,
            });
        }

        out.sort_by(|a, b| {
            b.modified_ms
                .cmp(&a.modified_ms)
                .then_with(|| a.name.cmp(&b.name))
        });

        self.emit(
            correlation_id,
            "model.manager.list_installed",
            EventStage::Complete,
            EventSeverity::Info,
            json!({ "count": out.len() }),
        );
        Ok(out)
    }

    pub fn search_hf(
        &self,
        correlation_id: &str,
        query: &str,
        limit: usize,
    ) -> Result<Vec<ModelManagerHfCandidate>, String> {
        self.emit(
            correlation_id,
            "model.manager.search_hf",
            EventStage::Start,
            EventSeverity::Info,
            json!({ "query": query, "limit": limit }),
        );
        let q = query.trim();
        if q.is_empty() {
            let message = "query is empty".to_string();
            self.emit(
                correlation_id,
                "model.manager.search_hf",
                EventStage::Error,
                EventSeverity::Error,
                json!({ "message": message }),
            );
            return Err(message);
        }

        let bounded_limit = limit.clamp(1, 20);
        let limit_text = bounded_limit.to_string();
        let client = reqwest::blocking::Client::builder()
            .user_agent("arxell-model-manager/0.1")
            .build()
            .map_err(|e| format!("failed to create HTTP client: {e}"))?;

        let search_results: Vec<HfSearchItem> = client
            .get("https://huggingface.co/api/models")
            .query(&[
                ("search", q),
                ("limit", limit_text.as_str()),
                ("full", "false"),
            ])
            .send()
            .and_then(|r| r.error_for_status())
            .map_err(|e| format!("hugging face search failed: {e}"))?
            .json()
            .map_err(|e| format!("failed to parse hugging face search response: {e}"))?;

        let mut out: Vec<ModelManagerHfCandidate> = Vec::new();
        for repo in search_results {
            if out.len() >= bounded_limit {
                break;
            }
            let Some(best) = best_gguf_for_repo(&client, repo.id.as_str()) else {
                continue;
            };
            out.push(ModelManagerHfCandidate {
                id: format!("{}::{}", best.repo_id, best.file_name),
                repo_id: best.repo_id,
                file_name: best.file_name,
                size_mb: best.size_bytes.map(|s| s / (1024 * 1024)),
                download_url: None,
            });
        }

        self.emit(
            correlation_id,
            "model.manager.search_hf",
            EventStage::Complete,
            EventSeverity::Info,
            json!({ "query": q, "count": out.len() }),
        );
        Ok(out)
    }

    pub fn download_from_hf(
        &self,
        correlation_id: &str,
        app_data_dir: &Path,
        repo_id: &str,
        file_name: Option<&str>,
    ) -> Result<ModelManagerInstalledModel, String> {
        let repo = repo_id.trim();
        if repo.is_empty() {
            return Err("repoId is empty".to_string());
        }
        self.emit(
            correlation_id,
            "model.manager.download_hf",
            EventStage::Start,
            EventSeverity::Info,
            json!({ "repoId": repo, "fileName": file_name }),
        );

        let models_dir = ensure_models_dir(app_data_dir)?;
        let client = reqwest::blocking::Client::builder()
            .user_agent("arxell-model-manager/0.1")
            .build()
            .map_err(|e| format!("failed to create HTTP client: {e}"))?;

        let chosen = select_repo_asset(&client, repo, file_name)?;
        let local_name = sanitize_filename(
            Path::new(chosen.file_name.as_str())
                .file_name()
                .and_then(|s| s.to_str())
                .unwrap_or("model.gguf"),
        );
        let final_path = models_dir.join(local_name);
        let temp_path = final_path.with_extension("gguf.part");
        if final_path.exists() {
            let existing = to_installed_model(&final_path)?;
            self.emit(
                correlation_id,
                "model.manager.download_hf",
                EventStage::Complete,
                EventSeverity::Info,
                json!({
                    "repoId": repo,
                    "fileName": chosen.file_name,
                    "path": existing.path,
                    "reusedExisting": true
                }),
            );
            return Ok(existing);
        }

        let url = format!(
            "https://huggingface.co/{}/resolve/main/{}?download=true",
            chosen.repo_id, chosen.file_name
        );
        self.emit(
            correlation_id,
            "model.manager.download_hf",
            EventStage::Progress,
            EventSeverity::Info,
            json!({ "repoId": repo, "fileName": chosen.file_name, "url": url }),
        );

        let mut response = client
            .get(url.as_str())
            .send()
            .and_then(|r| r.error_for_status())
            .map_err(|e| format!("model download failed: {e}"))?;
        let write_result = (|| -> Result<(), String> {
            let mut file = File::create(&temp_path)
                .map_err(|e| format!("failed to create temp model file: {e}"))?;
            response
                .copy_to(&mut file)
                .map_err(|e| format!("failed writing model file: {e}"))?;
            file.flush()
                .map_err(|e| format!("failed flushing model file: {e}"))?;
            std::fs::rename(&temp_path, &final_path)
                .map_err(|e| format!("failed finalizing model file: {e}"))?;
            Ok(())
        })();
        if let Err(err) = write_result {
            let _ = std::fs::remove_file(&temp_path);
            self.emit(
                correlation_id,
                "model.manager.download_hf",
                EventStage::Error,
                EventSeverity::Error,
                json!({ "repoId": repo, "fileName": chosen.file_name, "message": err }),
            );
            return Err(err);
        }

        let model = to_installed_model(&final_path)?;
        self.emit(
            correlation_id,
            "model.manager.download_hf",
            EventStage::Complete,
            EventSeverity::Info,
            json!({
                "repoId": repo,
                "fileName": chosen.file_name,
                "path": model.path,
                "sizeMb": model.size_mb
            }),
        );
        Ok(model)
    }

    pub fn delete_installed(
        &self,
        correlation_id: &str,
        app_data_dir: &Path,
        model_id: &str,
    ) -> Result<(), String> {
        self.emit(
            correlation_id,
            "model.manager.delete_installed",
            EventStage::Start,
            EventSeverity::Info,
            json!({ "modelId": model_id }),
        );

        let models_dir = ensure_models_dir(app_data_dir)?;
        let base = models_dir
            .canonicalize()
            .map_err(|e| format!("failed to resolve models directory: {e}"))?;
        let target = models_dir.join(model_id);
        if !is_gguf(&target) {
            let message = "only .gguf files can be deleted".to_string();
            self.emit(
                correlation_id,
                "model.manager.delete_installed",
                EventStage::Error,
                EventSeverity::Error,
                json!({ "modelId": model_id, "message": message }),
            );
            return Err(message);
        }
        let candidate = target
            .canonicalize()
            .map_err(|e| format!("invalid model path: {e}"))?;
        if !candidate.starts_with(&base) {
            let message = "refusing to delete file outside models directory".to_string();
            self.emit(
                correlation_id,
                "model.manager.delete_installed",
                EventStage::Error,
                EventSeverity::Error,
                json!({ "modelId": model_id, "message": message }),
            );
            return Err(message);
        }
        std::fs::remove_file(&candidate)
            .map_err(|e| format!("failed to delete model file: {e}"))?;
        self.emit(
            correlation_id,
            "model.manager.delete_installed",
            EventStage::Complete,
            EventSeverity::Info,
            json!({ "modelId": model_id }),
        );
        Ok(())
    }

    pub fn list_catalog_csv(
        &self,
        correlation_id: &str,
        list_name: &str,
    ) -> Result<Vec<ModelManagerCatalogCsvRow>, String> {
        let trimmed = list_name.trim();
        if trimmed.is_empty() {
            return Err("listName is empty".to_string());
        }
        self.emit(
            correlation_id,
            "model.manager.list_catalog_csv",
            EventStage::Start,
            EventSeverity::Info,
            json!({ "listName": trimmed }),
        );

        let base = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../model-lists");
        let file = base.join(format!("{trimmed}.csv"));
        let raw = std::fs::read_to_string(&file)
            .map_err(|e| format!("failed reading catalog csv {}: {e}", file.to_string_lossy()))?;
        let mut rows: Vec<ModelManagerCatalogCsvRow> = Vec::new();
        for (idx, line) in raw.lines().enumerate() {
            if idx == 0 || line.trim().is_empty() {
                continue;
            }
            let parts: Vec<&str> = line.split(',').collect();
            if parts.len() < 9 {
                continue;
            }
            let size_mb = parts[5].trim().parse::<u64>().ok();
            rows.push(ModelManagerCatalogCsvRow {
                repo_id: parts[0].trim().to_string(),
                model_name: parts[1].trim().to_string(),
                parameter_count: parts[2].trim().to_string(),
                file_name: parts[3].trim().to_string(),
                quant: parts[4].trim().to_string(),
                size_mb,
                download_url: parts[6].trim().to_string(),
            });
        }
        self.emit(
            correlation_id,
            "model.manager.list_catalog_csv",
            EventStage::Complete,
            EventSeverity::Info,
            json!({ "listName": trimmed, "count": rows.len() }),
        );
        Ok(rows)
    }

    fn emit(
        &self,
        correlation_id: &str,
        action: &str,
        stage: EventStage,
        severity: EventSeverity,
        payload: serde_json::Value,
    ) {
        let event = self.hub.make_event(
            correlation_id,
            Subsystem::Service,
            action,
            stage,
            severity,
            payload,
        );
        self.hub.emit(event);
    }
}

fn ensure_models_dir(app_data_dir: &Path) -> Result<PathBuf, String> {
    let models_dir = app_data_dir.join("models");
    std::fs::create_dir_all(&models_dir)
        .map_err(|e| format!("failed to create models directory: {e}"))?;
    Ok(models_dir)
}

fn to_installed_model(path: &Path) -> Result<ModelManagerInstalledModel, String> {
    let metadata =
        std::fs::metadata(path).map_err(|e| format!("failed to stat model file: {e}"))?;
    let name = path
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("unknown.gguf")
        .to_string();
    let modified_ms = metadata
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);
    Ok(ModelManagerInstalledModel {
        id: name.clone(),
        name,
        path: path.to_string_lossy().to_string(),
        size_mb: metadata.len() / (1024 * 1024),
        modified_ms,
    })
}

fn select_repo_asset(
    client: &reqwest::blocking::Client,
    repo_id: &str,
    requested_file_name: Option<&str>,
) -> Result<BestAsset, String> {
    let detail_url = format!("https://huggingface.co/api/models/{repo_id}");
    let detail: HfModelDetail = client
        .get(detail_url.as_str())
        .send()
        .and_then(|r| r.error_for_status())
        .map_err(|e| format!("hugging face repo lookup failed: {e}"))?
        .json()
        .map_err(|e| format!("failed to parse hugging face repo response: {e}"))?;
    let siblings = detail
        .siblings
        .ok_or_else(|| format!("no files listed for repo '{repo_id}'"))?;

    let requested = requested_file_name.unwrap_or("").trim();
    let requested_lower = requested.to_ascii_lowercase();
    let mut chosen = siblings
        .iter()
        .find(|s| s.rfilename.eq_ignore_ascii_case(requested))
        .map(|s| (s.rfilename.clone(), s.size));

    if chosen.is_none() && !requested_lower.is_empty() {
        chosen = siblings
            .iter()
            .find(|s| {
                s.rfilename
                    .to_ascii_lowercase()
                    .contains(requested_lower.as_str())
            })
            .map(|s| (s.rfilename.clone(), s.size));
    }

    if chosen.is_none() {
        let mut best: Option<(String, i32, Option<u64>)> = None;
        for sibling in &siblings {
            let score = score_gguf_filename(sibling.rfilename.as_str());
            if score < 0 {
                continue;
            }
            match best.as_ref() {
                Some((_, best_score, best_size))
                    if *best_score > score
                        || (*best_score == score
                            && best_size.unwrap_or(u64::MAX)
                                <= sibling.size.unwrap_or(u64::MAX)) => {}
                _ => {
                    best = Some((sibling.rfilename.clone(), score, sibling.size));
                }
            }
        }
        chosen = best.map(|(name, _, size)| (name, size));
    }

    let (file_name, size_bytes) = chosen.ok_or_else(|| {
        if requested.is_empty() {
            format!("no GGUF file found in repo '{repo_id}'")
        } else {
            format!(
                "requested file '{requested}' not found and no GGUF fallback exists in repo '{repo_id}'"
            )
        }
    })?;

    Ok(BestAsset {
        repo_id: repo_id.to_string(),
        file_name,
        size_bytes,
    })
}

fn best_gguf_for_repo(client: &reqwest::blocking::Client, repo_id: &str) -> Option<BestAsset> {
    select_repo_asset(client, repo_id, None).ok()
}

fn score_gguf_filename(name: &str) -> i32 {
    let lowered = name.to_ascii_lowercase();
    if !lowered.ends_with(".gguf") {
        return -1;
    }
    let mut score = 100;
    if lowered.contains("q4_k_m") {
        score += 60;
    }
    if lowered.contains("q4_k_s") {
        score += 55;
    }
    if lowered.contains("iq4") {
        score += 50;
    }
    if lowered.contains("q5_k_m") {
        score += 45;
    }
    if lowered.contains("q5_k_s") {
        score += 40;
    }
    if lowered.contains("q4_0") || lowered.contains("q4_1") {
        score += 30;
    }
    if lowered.contains("q8") || lowered.contains("f16") || lowered.contains("f32") {
        score -= 40;
    }
    if lowered.contains("imatrix") || lowered.contains("instruct-awq") {
        score -= 10;
    }
    if lowered.contains("mmproj") || lowered.contains("vision-proj") || lowered.contains("clip") {
        score -= 80;
    }
    score
}

fn sanitize_filename(raw: &str) -> String {
    let mut out = String::with_capacity(raw.len());
    for ch in raw.chars() {
        if ch.is_ascii_alphanumeric() || matches!(ch, '.' | '-' | '_') {
            out.push(ch);
        } else {
            out.push('_');
        }
    }
    if out.is_empty() {
        "model.gguf".to_string()
    } else if out.to_ascii_lowercase().ends_with(".gguf") {
        out
    } else {
        format!("{out}.gguf")
    }
}

fn is_gguf(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| e.eq_ignore_ascii_case("gguf"))
        == Some(true)
}

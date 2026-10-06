//! Relocatable Whisper dependency closure and shared model discovery.
use std::path::{Path, PathBuf};

pub(crate) const MODEL_NAMES: &[&str] = &[
    "ggml-base-q8_0.bin",
    "ggml-base.en-q8_0.bin",
    "ggml-tiny.en-q8_0.bin",
];

pub(crate) fn model_candidates(data: &Path, resources: &Path) -> Vec<PathBuf> {
    let roots = [
        data.join("STT/models"),
        data.join("stt/models"),
        data.join("models"),
        resources.join("whisper"),
        resources.join("models"),
        resources.join("resources/whisper"),
    ];
    roots
        .iter()
        .flat_map(|root| MODEL_NAMES.iter().map(move |name| root.join(name)))
        .collect()
}

/// A private, unique directory owns the executable AND its shared libraries.
/// Dropping it cleans up on failed preparation/startup as well as normal stop.
pub(crate) struct StagedWhisper {
    pub binary: PathBuf,
    directory: PathBuf,
}

impl Drop for StagedWhisper {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.directory);
    }
}

pub(crate) fn stage(binary: &Path) -> Result<StagedWhisper, String> {
    let directory = std::env::temp_dir().join(format!("arxell-whisper-{}", uuid::Uuid::new_v4()));
    let mut builder = std::fs::DirBuilder::new();
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        builder.mode(0o700);
    }
    builder
        .create(&directory)
        .map_err(|e| format!("Failed to create Whisper staging directory: {e}"))?;
    let name = binary
        .file_name()
        .ok_or("Whisper executable has no filename")?;
    let staged = StagedWhisper {
        binary: directory.join(name),
        directory,
    };
    std::fs::copy(binary, &staged.binary)
        .map_err(|e| format!("Failed to stage Whisper executable: {e}"))?;
    let parent = binary
        .parent()
        .ok_or("Whisper executable has no directory")?;
    for entry in std::fs::read_dir(parent)
        .map_err(|e| format!("Failed to read Whisper dependencies: {e}"))?
    {
        let entry = entry.map_err(|e| format!("Failed to read Whisper dependency: {e}"))?;
        let name = entry.file_name();
        let text = name.to_string_lossy().to_ascii_lowercase();
        if entry.path().is_file()
            && (text.ends_with(".dll")
                || text.ends_with(".dylib")
                || text.ends_with(".so")
                || text.contains(".so.")
                || text.ends_with(".metallib")
                || text.ends_with(".metal"))
        {
            // Copy symlink targets under their loader-visible sonames.
            std::fs::copy(entry.path(), staged.directory.join(name))
                .map_err(|e| format!("Failed to stage Whisper dependency: {e}"))?;
        }
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&staged.binary, std::fs::Permissions::from_mode(0o755))
            .map_err(|e| format!("Failed to chmod staged Whisper executable: {e}"))?;
    }
    Ok(staged)
}

pub(crate) fn loader_path(
    binary: &Path,
    previous: Option<std::ffi::OsString>,
) -> Result<std::ffi::OsString, String> {
    let parent = binary
        .parent()
        .ok_or("Whisper executable has no directory")?;
    let mut paths = vec![parent.to_path_buf()];
    if let Some(previous) = previous {
        paths.extend(std::env::split_paths(&previous));
    }
    std::env::join_paths(paths).map_err(|e| format!("Invalid Whisper library path: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn staged_closure_has_sonames_is_unique_and_is_cleaned_up() {
        let source = std::env::temp_dir().join(format!("whisper-fixture-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&source).unwrap();
        let binary = source.join("whisper-server");
        std::fs::write(&binary, b"fixture").unwrap();
        std::fs::write(source.join("libwhisper.so.1"), b"library").unwrap();
        std::fs::write(source.join("libgomp.so.1"), b"openmp").unwrap();
        std::fs::write(source.join("whisper.dll"), b"windows").unwrap();
        std::fs::write(source.join("libwhisper.dylib"), b"macos").unwrap();
        std::fs::write(source.join("notes.txt"), b"not needed").unwrap();
        let staged = stage(&binary).unwrap();
        let second = stage(&binary).unwrap();
        assert_ne!(staged.directory, second.directory);
        for name in [
            "libwhisper.so.1",
            "libgomp.so.1",
            "whisper.dll",
            "libwhisper.dylib",
        ] {
            assert!(staged.directory.join(name).is_file());
        }
        assert!(!staged.directory.join("notes.txt").exists());
        let paths = loader_path(&staged.binary, None).unwrap();
        assert_eq!(
            std::env::split_paths(&paths).next().unwrap(),
            staged.directory
        );
        let directory = staged.directory.clone();
        drop(staged);
        assert!(!directory.exists());
        drop(second);
        std::fs::remove_dir_all(source).unwrap();
    }

    /// Set ARXELL_TEST_WHISPER_BINARY to a prepared/package resource binary.
    #[test]
    #[ignore = "requires a real bundled Whisper runtime"]
    fn real_whisper_runs_from_staged_closure() {
        let binary =
            std::env::var_os("ARXELL_TEST_WHISPER_BINARY").expect("set ARXELL_TEST_WHISPER_BINARY");
        let staged = stage(Path::new(&binary)).unwrap();
        let variable = if cfg!(target_os = "windows") {
            "PATH"
        } else if cfg!(target_os = "macos") {
            "DYLD_LIBRARY_PATH"
        } else {
            "LD_LIBRARY_PATH"
        };
        let result = std::process::Command::new(&staged.binary)
            .env(
                variable,
                loader_path(
                    &staged.binary,
                    if cfg!(target_os = "windows") {
                        std::env::var_os(variable)
                    } else {
                        None
                    },
                )
                .unwrap(),
            )
            .arg("--help")
            .output()
            .unwrap();
        assert!(
            result.status.success(),
            "staged runtime failed: {}",
            String::from_utf8_lossy(&result.stderr)
        );
    }

    #[test]
    fn discovers_bundled_english_and_nested_models() {
        let candidates = model_candidates(Path::new("data"), Path::new("resources"));
        assert!(candidates
            .contains(&Path::new("resources/whisper/ggml-base.en-q8_0.bin").to_path_buf()));
        assert!(candidates.contains(
            &Path::new("resources/resources/whisper/ggml-tiny.en-q8_0.bin").to_path_buf()
        ));
        assert_eq!(
            candidates[0],
            Path::new("data/STT/models/ggml-base-q8_0.bin")
        );
    }
}

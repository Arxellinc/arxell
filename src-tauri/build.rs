//! Build script for arx
//!
//! This script:
//! 1. Calls tauri_build::build() for Tauri-specific build setup
//! 2. Detects GPU acceleration backends available on the system
//! 3. Emits cargo cfg flags for the selected backend
//! 4. Prints a summary of the selection for build logs
//!
/// Note: llama.cpp supports the following backends via features:
/// - cuda: NVIDIA GPU support
/// - metal: Apple Metal (macOS/iOS only)
/// - vulkan: Vulkan support (cross-platform GPU)
/// - rocm: ROCm/HIP (AMD GPU)
/// - openmp: OpenMP for CPU parallelism
/// - dynamic-link: Dynamic linking
/// - sampler: Sampling (only has effect on Android)
/// - mtmd: Memory-mapped disk I/O (only has effect on Android)
/// - cpu: default when no GPU features are enabled
use std::env;
use std::path::Path;
use std::process::Command;

fn build_info(message: impl AsRef<str>) {
    eprintln!("[arx build] {}", message.as_ref());
}

fn main() {
    // Tauri build setup
    tauri_build::build();

    // Detect OS - use CARGO_CFG_TARGET_OS for build scripts
    let target_os = env::var("CARGO_CFG_TARGET_OS").unwrap_or_else(|_| "unknown".to_string());
    let target_arch = env::var("CARGO_CFG_TARGET_ARCH").unwrap_or_else(|_| "unknown".to_string());

    build_info(format!(
        "detecting GPU backend for {}-{}",
        target_os, target_arch
    ));

    // On macOS/iOS, always use Metal - no probing needed
    if target_os == "macos" || target_os == "ios" {
        emit_backend("metal", "Apple platform - Metal is always available");
        return;
    }

    // Probe for GPU backends
    let cuda_detected = probe_cuda();
    let rocm_detected = probe_rocm();
    let vulkan_detected = probe_vulkan();

    // Select backend based on detection results
    // Priority: CUDA > ROCm > Vulkan > CPU
    let (backend, reason) = if cuda_detected {
        ("cuda", "CUDA toolkit detected")
    } else if rocm_detected {
        ("rocm", "ROCm/HIP detected (AMD GPU)")
    } else if vulkan_detected {
        ("vulkan", "Vulkan SDK detected")
    } else {
        ("cpu", "No GPU acceleration detected - using CPU")
    };

    emit_backend(backend, reason);
}

/// Probe for CUDA toolkit
/// Checks CUDA_PATH environment variable and nvcc in PATH
fn probe_cuda() -> bool {
    // Check CUDA_PATH environment variable
    if env::var("CUDA_PATH").is_ok() {
        build_info("CUDA_PATH found");
        return true;
    }

    // Check for nvcc in PATH
    if Command::new("nvcc").arg("--version").output().is_ok() {
        build_info("nvcc found in PATH");
        return true;
    }

    // Check common CUDA installation paths on Linux
    #[cfg(target_os = "linux")]
    {
        let cuda_paths = ["/usr/local/cuda", "/opt/cuda"];
        for path in &cuda_paths {
            if Path::new(path).exists() {
                build_info(format!("CUDA installation found at {}", path));
                return true;
            }
        }
    }

    false
}

/// Probe for ROCm (AMD ROCm/HIP stack)
/// Checks ROCM_PATH environment variable and hipcc in PATH
fn probe_rocm() -> bool {
    // Check ROCM_PATH environment variable
    if env::var("ROCM_PATH").is_ok() {
        build_info("ROCM_PATH found");
        return true;
    }

    // Check for hipcc in PATH
    if Command::new("hipcc").arg("--version").output().is_ok() {
        build_info("hipcc found in PATH");
        return true;
    }

    // Check for ROCm in common paths on Linux
    #[cfg(target_os = "linux")]
    {
        let rocm_paths = ["/opt/rocm", "/usr/local/rocm"];
        for path in &rocm_paths {
            if Path::new(path).exists() {
                build_info(format!("ROCm installation found at {}", path));
                return true;
            }
        }
    }

    false
}

/// Probe for Vulkan SDK
/// Checks VULKAN_SDK environment variable
fn probe_vulkan() -> bool {
    // Check VULKAN_SDK environment variable
    if env::var("VULKAN_SDK").is_ok() {
        build_info("VULKAN_SDK found");
        return true;
    }

    // Check for vulkaninfo in PATH (indicates Vulkan SDK installed)
    if Command::new("vulkaninfo").arg("--summary").output().is_ok() {
        build_info("vulkaninfo found - Vulkan runtime available");
        return true;
    }

    // Check common Vulkan SDK installation paths
    #[cfg(target_os = "linux")]
    {
        let vulkan_paths = ["/usr/share/vulkan", "/usr/local/share/vulkan"];
        for path in &vulkan_paths {
            if Path::new(path).exists() {
                build_info(format!("Vulkan installation found at {}", path));
                return true;
            }
        }
    }

    #[cfg(target_os = "windows")]
    {
        // On Windows, check for Vulkan SDK in Program Files
        if let Ok(program_files) = env::var("ProgramFiles") {
            let vulkan_path = format!("{}\\VulkanSDK", program_files);
            if Path::new(&vulkan_path).exists() {
                build_info("Vulkan SDK found in Program Files");
                return true;
            }
        }
    }

    false
}

/// Emit the selected backend configuration and check build-time memory.
fn emit_backend(backend: &str, reason: &str) {
    println!("cargo:rustc-cfg=backend=\"{}\"", backend);
    build_info(format!("llama-cpp-2 backend: {} ({})", backend, reason));

    // Make the detected backend available at compile time via env!()
    println!("cargo:rustc-env=LLAMA_CPP_BACKEND={}", backend);

    // ── Build-time memory check ───────────────────────────────────────────────
    // GPU builds compile llama.cpp from C++ source (hundreds of MB of object
    // files).  The linker then needs to process all of them.  On systems with
    // < 8 GB free this often causes an OOM kill.  Emit an early warning so the
    // developer sees the risk before the build starts rather than minutes into
    // a failed link.
    if backend != "cpu" {
        let avail_gb = available_ram_gb();
        build_info(format!("available RAM at build start: {:.1} GB", avail_gb));

        if avail_gb > 0.0 && avail_gb < 8.0 {
            println!(
                "cargo:warning=⚠️  Low RAM ({:.1} GB available) for a {} GPU build. \
                 Compiling llama.cpp may require 8–16 GB. \
                 Tip: close other applications or pass `-j 2` to cargo.",
                avail_gb, backend,
            );
        }
    }
}

/// Read available system RAM in GB from /proc/meminfo (Linux) or best-effort
/// estimate on other platforms.  Returns 0.0 if the value cannot be read.
fn available_ram_gb() -> f64 {
    // Linux
    #[cfg(target_os = "linux")]
    if let Ok(content) = std::fs::read_to_string("/proc/meminfo") {
        for line in content.lines() {
            if line.starts_with("MemAvailable:") {
                if let Some(kb_str) = line.split_whitespace().nth(1) {
                    if let Ok(kb) = kb_str.parse::<u64>() {
                        return kb as f64 / (1024.0 * 1024.0);
                    }
                }
            }
        }
    }

    // macOS — use `vm_stat` output as a rough estimate
    #[cfg(target_os = "macos")]
    {
        // Not worth shelling out; return 0 to skip the warning
    }

    0.0
}

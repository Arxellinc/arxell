//! System information gathering for compute resources
//!
//! Provides detailed information about CPU, RAM, GPUs, NPUs, and driver availability.

use serde::{Deserialize, Serialize};
use std::time::{SystemTime, UNIX_EPOCH};
use sysinfo::{CpuRefreshKind, Disks, RefreshKind, System};
#[cfg(target_os = "windows")]
use std::sync::{LazyLock, Mutex};
#[cfg(target_os = "windows")]
use std::time::{Duration, Instant};

/// Inference engine types supported by the application
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InferenceEngine {
    /// Engine identifier (e.g., "llama.cpp-vulkan", "llama.cpp-cuda")
    pub id: String,
    /// Display name for the engine
    pub name: String,
    /// Engine type (llama.cpp, onnx, etc.)
    pub engine_type: String,
    /// Acceleration backend (vulkan, cuda, metal, rocm, cpu)
    pub backend: String,
    /// Whether this engine is available on this system
    pub is_available: bool,
    /// Whether this engine is applicable to the current platform
    pub is_applicable: bool,
    /// Whether this is the recommended engine for this system
    pub is_recommended: bool,
    /// Version string if available
    pub version: Option<String>,
    /// Path to the engine binary if found
    pub binary_path: Option<String>,
    /// Any error message if engine check failed
    pub error: Option<String>,
}

/// Runtime status containing all inference engine information
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeStatus {
    /// List of all supported/compatible engines for this system
    pub engines: Vec<InferenceEngine>,
    /// The currently active engine (if any)
    pub active_engine: Option<String>,
    /// Whether any engine is available
    pub has_available_engine: bool,
    /// Warning message if no engines are available
    pub warning: Option<String>,
}

/// Information about system CPU
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CpuInfo {
    /// CPU name/brand
    pub name: String,
    /// Number of physical cores
    pub physical_cores: usize,
    /// Number of logical cores (including hyperthreading)
    pub logical_cores: usize,
    /// CPU architecture (x86_64, aarch64, etc.)
    pub arch: String,
}

/// Information about system memory
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryInfo {
    /// Total system RAM in MB
    pub total_mb: u64,
    /// Available RAM in MB
    pub available_mb: u64,
    /// Used RAM in MB
    pub used_mb: u64,
    /// Usage percentage
    pub usage_percent: f32,
}

/// GPU driver status
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DriverStatus {
    /// Driver type (cuda, vulkan, rocm, metal)
    pub driver_type: String,
    /// Whether driver is installed and available
    pub is_available: bool,
    /// Driver version if available
    pub version: Option<String>,
    /// Any error message if driver check failed
    pub error: Option<String>,
}

/// Information about a GPU device
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GpuInfo {
    /// Device ID (e.g., "cuda:0", "vulkan:0")
    pub id: String,
    /// GPU name
    pub name: String,
    /// GPU type (cuda, vulkan, rocm, metal)
    pub gpu_type: String,
    /// Total VRAM in MB (None for unified memory)
    pub vram_mb: Option<u64>,
    /// Available VRAM in MB
    pub available_vram_mb: Option<u64>,
    /// Whether this GPU is available for compute
    pub is_available: bool,
    /// Driver status for this GPU
    pub driver: DriverStatus,
}

/// Information about an NPU (Neural Processing Unit)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NpuInfo {
    /// NPU name
    pub name: String,
    /// NPU type (e.g., "intel_npu", "apple_neural_engine", "qualcomm_npu")
    pub npu_type: String,
    /// Whether NPU is available
    pub is_available: bool,
    /// Driver/software status
    pub driver: DriverStatus,
}

/// Complete system resources information
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemResources {
    /// CPU information
    pub cpu: CpuInfo,
    /// Memory information
    pub memory: MemoryInfo,
    /// Available GPUs
    pub gpus: Vec<GpuInfo>,
    /// Available NPUs
    pub npus: Vec<NpuInfo>,
    /// All driver statuses
    pub drivers: Vec<DriverStatus>,
}

/// Real-time GPU usage snapshot
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GpuUsage {
    /// Device ID (e.g., "cuda:0", "vulkan:0")
    pub id: String,
    /// Current GPU utilization percentage
    pub utilization_percent: Option<f32>,
    /// Total GPU memory in MB
    pub memory_total_mb: Option<u64>,
    /// Used GPU memory in MB
    pub memory_used_mb: Option<u64>,
}

/// Real-time system usage snapshot
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemUsage {
    /// Current CPU utilization percentage
    pub cpu_utilization_percent: Option<f32>,
    /// Current system memory utilization percentage
    pub memory_usage_percent: f32,
    /// Per-GPU usage snapshots
    pub gpus: Vec<GpuUsage>,
    /// NPU utilization percentage (Intel NPU / Apple Neural Engine / Qualcomm NPU)
    pub npu_utilization_percent: Option<f32>,
    /// Snapshot time in unix milliseconds
    pub timestamp_ms: u64,
}

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;
#[cfg(target_os = "windows")]
const WINDOWS_GPU_USAGE_TTL: Duration = Duration::from_secs(10);
#[cfg(target_os = "windows")]
static WINDOWS_GPU_USAGE_CACHE: LazyLock<Mutex<(Option<Instant>, Vec<GpuUsage>)>> =
    LazyLock::new(|| Mutex::new((None, Vec::new())));

#[cfg(target_os = "windows")]
fn run_windows_command_hidden(program: &str, args: &[&str]) -> Option<std::process::Output> {
    use std::os::windows::process::CommandExt;

    std::process::Command::new(program)
        .args(args)
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .ok()
}

/// Storage device and mounted volume information
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageDevice {
    pub name: String,
    pub mount_point: String,
    pub file_system: String,
    pub kind: String,
    pub total_mb: u64,
    pub available_mb: u64,
    pub used_mb: u64,
    pub usage_percent: f32,
    pub is_removable: bool,
}

/// Basic OS/system/CPU/user identity metadata for UI headers.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemIdentity {
    pub os_name: Option<String>,
    pub os_version: Option<String>,
    pub kernel_version: Option<String>,
    pub host_name: Option<String>,
    pub uptime_secs: u64,
    pub boot_time_secs: u64,
    pub user_name: Option<String>,
    pub cpu_name: String,
    pub cpu_arch: String,
    pub cpu_physical_cores: usize,
    pub cpu_logical_cores: usize,
}

/// Get CPU information
pub fn get_cpu_info() -> CpuInfo {
    let mut sys = System::new_with_specifics(
        RefreshKind::everything().with_cpu(CpuRefreshKind::everything()),
    );
    sys.refresh_cpu_all();

    let name = if let Some(cpu) = sys.cpus().first() {
        let brand = cpu.brand();
        if !brand.is_empty() {
            brand.to_string()
        } else {
            "Unknown CPU".to_string()
        }
    } else {
        "Unknown CPU".to_string()
    };

    // Get physical core count using the System instance
    let physical_cores = sys.physical_core_count().unwrap_or(1);

    // Try to get CPU name from /proc/cpuinfo on Linux for more detail
    #[cfg(target_os = "linux")]
    let name = {
        if let Ok(contents) = std::fs::read_to_string("/proc/cpuinfo") {
            for line in contents.lines() {
                if line.starts_with("model name") {
                    if let Some(n) = line.split(':').nth(1) {
                        return CpuInfo {
                            name: n.trim().to_string(),
                            physical_cores,
                            logical_cores: sys.cpus().len(),
                            arch: std::env::consts::ARCH.to_string(),
                        };
                    }
                }
            }
        }
        name
    };

    CpuInfo {
        name,
        physical_cores,
        logical_cores: sys.cpus().len(),
        arch: std::env::consts::ARCH.to_string(),
    }
}

/// Get memory information
pub fn get_memory_info() -> MemoryInfo {
    let mut sys = System::new();
    sys.refresh_memory();

    let total = sys.total_memory() / (1024 * 1024);
    let available = sys.available_memory() / (1024 * 1024);
    let used = sys.used_memory() / (1024 * 1024);
    let usage_percent = if total > 0 {
        (used as f64 / total as f64 * 100.0) as f32
    } else {
        0.0
    };

    MemoryInfo {
        total_mb: total,
        available_mb: available,
        used_mb: used,
        usage_percent,
    }
}

/// Check if CUDA driver is available
pub fn check_cuda_driver() -> DriverStatus {
    #[cfg(feature = "cuda")]
    {
        // Try to check CUDA availability
        // In a full implementation, we'd call into CUDA runtime
        DriverStatus {
            driver_type: "cuda".to_string(),
            is_available: true,
            version: None, // Would query nvcc --version or CUDA runtime
            error: None,
        }
    }

    #[cfg(not(feature = "cuda"))]
    {
        let nvidia_smi_ok = std::process::Command::new("nvidia-smi")
            .arg("--query-gpu=driver_version")
            .arg("--format=csv,noheader")
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false);
        let nvcc_ok = std::process::Command::new("nvcc")
            .arg("--version")
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false);
        if nvidia_smi_ok || nvcc_ok {
            return DriverStatus {
                driver_type: "cuda".to_string(),
                is_available: true,
                version: None,
                error: None,
            };
        }
        DriverStatus {
            driver_type: "cuda".to_string(),
            is_available: false,
            version: None,
            error: Some("CUDA driver not detected".to_string()),
        }
    }
}

/// Check if Vulkan driver is available
pub fn check_vulkan_driver() -> DriverStatus {
    #[cfg(feature = "vulkan")]
    {
        DriverStatus {
            driver_type: "vulkan".to_string(),
            is_available: true,
            version: None,
            error: None,
        }
    }

    #[cfg(not(feature = "vulkan"))]
    {
        // Try multiple methods to detect Vulkan

        // Method 1: Try vulkaninfo command
        if let Ok(output) = std::process::Command::new("vulkaninfo")
            .arg("--summary")
            .output()
        {
            if output.status.success() {
                // Try to extract version from output
                let info = String::from_utf8_lossy(&output.stdout);
                let version = info
                    .lines()
                    .find(|l| l.contains("Vulkan Instance Version"))
                    .map(|l| l.split(':').nth(1).map(|s| s.trim().to_string()))
                    .flatten();

                return DriverStatus {
                    driver_type: "vulkan".to_string(),
                    is_available: true,
                    version,
                    error: None,
                };
            }
        }

        // Method 2: Check for Vulkan loader library on Linux
        #[cfg(target_os = "linux")]
        {
            let vulkan_loader_paths = [
                "/usr/lib/x86_64-linux-gnu/libvulkan.so",
                "/usr/lib/x86_64-linux-gnu/libvulkan.so.1",
                "/usr/lib/libvulkan.so",
                "/usr/lib/libvulkan.so.1",
                "/usr/local/lib/libvulkan.so",
                "/usr/local/lib/libvulkan.so.1",
                "/lib/x86_64-linux-gnu/libvulkan.so.1",
                "/lib/aarch64-linux-gnu/libvulkan.so.1",
            ];

            for path in &vulkan_loader_paths {
                if std::path::Path::new(path).exists() {
                    return DriverStatus {
                        driver_type: "vulkan".to_string(),
                        is_available: true,
                        version: None,
                        error: None,
                    };
                }
            }

            // Also check using ldconfig
            if let Ok(output) = std::process::Command::new("ldconfig").arg("-p").output() {
                let cache = String::from_utf8_lossy(&output.stdout);
                if cache.contains("libvulkan.so") {
                    return DriverStatus {
                        driver_type: "vulkan".to_string(),
                        is_available: true,
                        version: None,
                        error: None,
                    };
                }
            }

            // Check for Vulkan ICD files
            let icd_paths = [
                "/usr/share/vulkan/icd.d",
                "/etc/vulkan/icd.d",
                "/usr/local/share/vulkan/icd.d",
            ];

            for icd_path in &icd_paths {
                if std::path::Path::new(icd_path).exists() {
                    if let Ok(entries) = std::fs::read_dir(*icd_path) {
                        for entry in entries.flatten() {
                            if entry
                                .path()
                                .extension()
                                .map(|e| e == "json")
                                .unwrap_or(false)
                            {
                                return DriverStatus {
                                    driver_type: "vulkan".to_string(),
                                    is_available: true,
                                    version: None,
                                    error: None,
                                };
                            }
                        }
                    }
                }
            }
        }

        DriverStatus {
            driver_type: "vulkan".to_string(),
            is_available: false,
            version: None,
            error: Some("Vulkan not detected".to_string()),
        }
    }
}

/// Check if ROCm driver is available
pub fn check_rocm_driver() -> DriverStatus {
    #[cfg(feature = "rocm")]
    {
        DriverStatus {
            driver_type: "rocm".to_string(),
            is_available: true,
            version: None,
            error: None,
        }
    }

    #[cfg(not(feature = "rocm"))]
    {
        // Check for ROCm installation
        let is_available = std::path::Path::new("/opt/rocm").exists()
            || std::process::Command::new("rocminfo")
                .output()
                .map(|_| true)
                .unwrap_or(false);

        DriverStatus {
            driver_type: "rocm".to_string(),
            is_available,
            version: None,
            error: if is_available {
                None
            } else {
                Some("ROCm not detected".to_string())
            },
        }
    }
}

/// Check if Metal is available (macOS only)
pub fn check_metal_driver() -> DriverStatus {
    #[cfg(feature = "metal")]
    {
        DriverStatus {
            driver_type: "metal".to_string(),
            is_available: true,
            version: None,
            error: None,
        }
    }

    #[cfg(not(feature = "metal"))]
    {
        #[cfg(target_os = "macos")]
        {
            DriverStatus {
                driver_type: "metal".to_string(),
                is_available: true,
                version: None,
                error: Some("Metal support not compiled in".to_string()),
            }
        }

        #[cfg(not(target_os = "macos"))]
        {
            DriverStatus {
                driver_type: "metal".to_string(),
                is_available: false,
                version: None,
                error: Some("Metal only available on macOS".to_string()),
            }
        }
    }
}

/// Get list of available GPUs
pub fn get_gpus() -> Vec<GpuInfo> {
    #[cfg(target_os = "linux")]
    {
        return get_gpus_linux();
    }

    #[cfg(not(target_os = "linux"))]
    {
        let mut gpus = Vec::new();

        // Check CUDA GPUs
        #[cfg(feature = "cuda")]
        {
            gpus.push(GpuInfo {
                id: "cuda:0".to_string(),
                name: "NVIDIA GPU".to_string(),
                gpu_type: "cuda".to_string(),
                vram_mb: None, // Would query actual VRAM
                available_vram_mb: None,
                is_available: true,
                driver: check_cuda_driver(),
            });
        }

        // Fallback CUDA detection via nvidia-smi when feature not compiled in
        #[cfg(not(feature = "cuda"))]
        {
            if let Ok(output) = std::process::Command::new("nvidia-smi")
                .arg("--query-gpu=name")
                .arg("--format=csv,noheader")
                .output()
            {
                if output.status.success() {
                    let names = String::from_utf8_lossy(&output.stdout);
                    for (idx, name) in names.lines().filter(|l| !l.trim().is_empty()).enumerate() {
                        // Try to get VRAM from nvidia-smi
                        let vram = std::process::Command::new("nvidia-smi")
                            .arg("--query-gpu=memory.total")
                            .arg("--format=csv,noheader,nounits")
                            .output()
                            .ok()
                            .and_then(|vram_output| {
                                let vram_str = String::from_utf8_lossy(&vram_output.stdout);
                                vram_str.lines().nth(idx)?.trim().parse::<u64>().ok()
                            });

                        gpus.push(GpuInfo {
                            id: format!("cuda:{}", idx),
                            name: name.trim().to_string(),
                            gpu_type: "cuda".to_string(),
                            vram_mb: vram,
                            available_vram_mb: None,
                            is_available: true,
                            driver: DriverStatus {
                                driver_type: "cuda".to_string(),
                                is_available: true,
                                version: None,
                                error: None,
                            },
                        });
                    }
                }
            }
        }

        // Check Vulkan GPUs
        #[cfg(feature = "vulkan")]
        {
            gpus.push(GpuInfo {
                id: "vulkan:0".to_string(),
                name: "Vulkan GPU".to_string(),
                gpu_type: "vulkan".to_string(),
                vram_mb: None,
                available_vram_mb: None,
                is_available: true,
                driver: check_vulkan_driver(),
            });
        }

        // Fallback Vulkan detection via vulkaninfo when feature not compiled in
        #[cfg(not(feature = "vulkan"))]
        {
            if let Ok(output) = std::process::Command::new("vulkaninfo")
                .arg("--summary")
                .output()
            {
                if output.status.success() {
                    let info = String::from_utf8_lossy(&output.stdout);
                    // Parse device names from vulkaninfo output
                    for (idx, line) in info.lines().enumerate() {
                        if line.contains("deviceName")
                            || line.starts_with("GPU")
                            || line.contains("deviceName =")
                        {
                            // Try to extract the GPU name
                            let name = if let Some(eq_pos) = line.find('=') {
                                line[eq_pos + 1..].trim().trim_matches('"').to_string()
                            } else if line.starts_with("GPU") {
                                // Format like "GPU0: device name" or similar
                                line.split(':')
                                    .nth(1)
                                    .map(|s| s.trim().to_string())
                                    .unwrap_or_else(|| line.to_string())
                            } else {
                                continue;
                            };

                            if !name.is_empty() && name != "deviceName" {
                                gpus.push(GpuInfo {
                                    id: format!("vulkan:{}", idx),
                                    name: name.clone(),
                                    gpu_type: "vulkan".to_string(),
                                    vram_mb: None,
                                    available_vram_mb: None,
                                    is_available: true,
                                    driver: DriverStatus {
                                        driver_type: "vulkan".to_string(),
                                        is_available: true,
                                        version: None,
                                        error: None,
                                    },
                                });
                            }
                        }
                    }

                    // If we didn't find any GPUs via parsing but vulkaninfo succeeded, add a generic entry
                    if gpus.is_empty() && output.status.success() {
                        gpus.push(GpuInfo {
                            id: "vulkan:0".to_string(),
                            name: "Vulkan Compatible GPU".to_string(),
                            gpu_type: "vulkan".to_string(),
                            vram_mb: None,
                            available_vram_mb: None,
                            is_available: true,
                            driver: DriverStatus {
                                driver_type: "vulkan".to_string(),
                                is_available: true,
                                version: None,
                                error: None,
                            },
                        });
                    }
                }
            }
        }

        // Check Metal GPUs (macOS)
        #[cfg(feature = "metal")]
        {
            gpus.push(GpuInfo {
                id: "metal:0".to_string(),
                name: "Apple Metal".to_string(),
                gpu_type: "metal".to_string(),
                vram_mb: None,
                available_vram_mb: None,
                is_available: true,
                driver: check_metal_driver(),
            });
        }

        // Fallback Metal detection on macOS when feature not compiled in
        #[cfg(all(not(feature = "metal"), target_os = "macos"))]
        {
            // Use system_profiler to get GPU info on macOS
            if let Ok(output) = std::process::Command::new("system_profiler")
                .arg("SPDisplaysDataType")
                .output()
            {
                if output.status.success() {
                    let info = String::from_utf8_lossy(&output.stdout);
                    let mut idx = 0;
                    for line in info.lines() {
                        if line.contains("Chipset Model:") || line.contains("Vendor:") {
                            let name = line
                                .split(':')
                                .nth(1)
                                .map(|s| s.trim().to_string())
                                .unwrap_or_else(|| "Apple GPU".to_string());

                            gpus.push(GpuInfo {
                                id: format!("metal:{}", idx),
                                name,
                                gpu_type: "metal".to_string(),
                                vram_mb: None,
                                available_vram_mb: None,
                                is_available: true,
                                driver: DriverStatus {
                                    driver_type: "metal".to_string(),
                                    is_available: true,
                                    version: None,
                                    error: None,
                                },
                            });
                            idx += 1;
                        }
                    }
                }
            }
        }

        // Check ROCm GPUs
        #[cfg(feature = "rocm")]
        {
            gpus.push(GpuInfo {
                id: "rocm:0".to_string(),
                name: "AMD GPU (ROCm)".to_string(),
                gpu_type: "rocm".to_string(),
                vram_mb: None,
                available_vram_mb: None,
                is_available: true,
                driver: check_rocm_driver(),
            });
        }

        // Fallback ROCm detection via rocminfo when feature not compiled in
        #[cfg(not(feature = "rocm"))]
        {
            if let Ok(output) = std::process::Command::new("rocminfo").output() {
                if output.status.success() {
                    let info = String::from_utf8_lossy(&output.stdout);
                    let mut idx = 0;
                    for line in info.lines() {
                        if line.contains("Marketing Name:") || line.contains("Device Name:") {
                            let name = line
                                .split(':')
                                .nth(1)
                                .map(|s| s.trim().to_string())
                                .unwrap_or_else(|| "AMD GPU".to_string());

                            if !name.is_empty() && name != "Device" && name != "Marketing Name" {
                                gpus.push(GpuInfo {
                                    id: format!("rocm:{}", idx),
                                    name,
                                    gpu_type: "rocm".to_string(),
                                    vram_mb: None,
                                    available_vram_mb: None,
                                    is_available: true,
                                    driver: DriverStatus {
                                        driver_type: "rocm".to_string(),
                                        is_available: true,
                                        version: None,
                                        error: None,
                                    },
                                });
                                idx += 1;
                            }
                        }
                    }
                }
            }
        }

        // On Linux, also check for GPUs via /sys/class/drm
        #[cfg(target_os = "linux")]
        {
            // Track which cards we've already added to avoid duplicates
            let mut seen_cards: std::collections::HashSet<String> =
                std::collections::HashSet::new();

            // Check for any DRM devices (GPU render nodes)
            if let Ok(entries) = std::fs::read_dir("/sys/class/drm") {
                for entry in entries.flatten() {
                    let path = entry.path();
                    let name = path
                        .file_name()
                        .unwrap_or_default()
                        .to_string_lossy()
                        .to_string();

                    // Only match cardN (not cardN-XXX which are outputs) or renderDN
                    let is_card = name.starts_with("card")
                        && !name.contains('-')
                        && name.len() > 4
                        && name[4..].chars().all(|c| c.is_numeric());
                    let is_render = name.starts_with("renderD");

                    if is_card || is_render {
                        // Get the card number to track duplicates
                        let card_id = if is_card {
                            name[4..].to_string()
                        } else {
                            // renderD128 maps to card0, renderD129 to card1, etc.
                            name[7..]
                                .parse::<u32>()
                                .map(|n| (n - 128).to_string())
                                .unwrap_or_default()
                        };

                        if seen_cards.contains(&card_id) {
                            continue;
                        }
                        seen_cards.insert(card_id);

                        // Try to get the driver name from the driver symlink
                        let driver_name =
                            std::fs::read_dir(path.join("device/driver/module/drivers"))
                                .ok()
                                .and_then(|entries| {
                                    for entry in entries.flatten() {
                                        let name = entry.file_name().to_string_lossy().to_string();
                                        // Format is "pci:amdgpu" or similar
                                        if let Some(driver) = name.split(':').nth(1) {
                                            return Some(driver.to_string());
                                        }
                                    }
                                    None
                                })
                                // Fallback: read the driver symlink directly
                                .or_else(|| {
                                    std::fs::read_link(path.join("device/driver"))
                                        .ok()
                                        .and_then(|p| {
                                            p.file_name().map(|n| n.to_string_lossy().to_string())
                                        })
                                });

                        // Try to get the device uevent for more info
                        let uevent = std::fs::read_to_string(path.join("device/uevent")).ok();

                        // Determine GPU type from driver
                        let (gpu_type, gpu_name) = if let Some(ref driver) = driver_name {
                            match driver.as_str() {
                                "amdgpu" | "radeon" => {
                                    // Try to get the actual GPU name from PCI
                                    let pci_name = uevent
                                        .as_ref()
                                        .and_then(|u| {
                                            u.lines().find(|l| l.starts_with("PCI_ID=")).map(|l| {
                                                let pci_id = &l[7..];
                                                // Map common PCI IDs to names
                                                match pci_id {
                                                    "1002:1586" => {
                                                        "AMD Radeon Pro WX 7100".to_string()
                                                    }
                                                    id if id.starts_with("1002:") => {
                                                        format!("AMD GPU ({})", id)
                                                    }
                                                    other => format!("AMD GPU ({})", other),
                                                }
                                            })
                                        })
                                        .unwrap_or_else(|| "AMD GPU".to_string());
                                    ("vulkan", pci_name)
                                }
                                "nvidia" => ("cuda", "NVIDIA GPU".to_string()),
                                "nouveau" => ("vulkan", "NVIDIA GPU (Nouveau)".to_string()),
                                "i915" | "intel" => ("vulkan", "Intel Graphics".to_string()),
                                _ => ("vulkan", format!("GPU ({})", driver)),
                            }
                        } else {
                            // Fallback: try to parse uevent for PCI info
                            let fallback_name = uevent
                                .as_ref()
                                .and_then(|u| {
                                    u.lines()
                                        .find(|l| l.starts_with("PCI_ID="))
                                        .map(|l| format!("GPU ({})", &l[7..]))
                                })
                                .unwrap_or_else(|| "Unknown GPU".to_string());
                            ("vulkan", fallback_name)
                        };

                        // Read VRAM from sysfs for AMD GPUs (amdgpu/radeon kernel driver).
                        // The mem_info_vram_total file gives dedicated VRAM in bytes.
                        let vram_mb = match driver_name.as_deref() {
                            Some("amdgpu") | Some("radeon") => {
                                std::fs::read_to_string(path.join("device/mem_info_vram_total"))
                                    .ok()
                                    .and_then(|s| s.trim().parse::<u64>().ok())
                                    .map(|bytes| bytes / (1024 * 1024))
                            }
                            _ => None,
                        };

                        gpus.push(GpuInfo {
                            id: format!("{}:{}", gpu_type, gpus.len()),
                            name: gpu_name,
                            gpu_type: gpu_type.to_string(),
                            vram_mb,
                            available_vram_mb: None,
                            is_available: true,
                            driver: DriverStatus {
                                driver_type: gpu_type.to_string(),
                                is_available: true,
                                version: None,
                                error: None,
                            },
                        });
                    }
                }
            }
        }

        gpus
    }
}

#[cfg(target_os = "linux")]
fn normalize_pci_bus_id(input: &str) -> String {
    let s = input.trim().to_lowercase();
    let parts: Vec<&str> = s.split(':').collect();
    if parts.len() != 3 {
        return s;
    }
    let (domain_s, bus_s, dev_func) = (parts[0], parts[1], parts[2]);
    let mut dev_func_parts = dev_func.split('.');
    let dev_s = dev_func_parts.next().unwrap_or_default();
    let func_s = dev_func_parts.next().unwrap_or_default();
    if dev_func_parts.next().is_some() {
        return s;
    }

    let parsed = (
        u16::from_str_radix(domain_s, 16),
        u8::from_str_radix(bus_s, 16),
        u8::from_str_radix(dev_s, 16),
        u8::from_str_radix(func_s, 10),
    );

    match parsed {
        (Ok(domain), Ok(bus), Ok(dev), Ok(func)) => {
            format!("{:04x}:{:02x}:{:02x}.{}", domain, bus, dev, func)
        }
        _ => s,
    }
}

#[cfg(target_os = "linux")]
fn query_nvidia_meta_by_bus() -> std::collections::HashMap<String, (String, Option<u64>)> {
    let mut map = std::collections::HashMap::new();
    let out = std::process::Command::new("nvidia-smi")
        .arg("--query-gpu=pci.bus_id,name,memory.total")
        .arg("--format=csv,noheader,nounits")
        .output();

    if let Ok(output) = out {
        if output.status.success() {
            let stdout = String::from_utf8_lossy(&output.stdout);
            for line in stdout.lines() {
                let cols: Vec<&str> = line.split(',').map(|s| s.trim()).collect();
                if cols.len() < 3 {
                    continue;
                }
                let bus = normalize_pci_bus_id(cols[0]);
                let name = cols[1].to_string();
                let vram = cols[2].parse::<u64>().ok();
                map.insert(bus, (name, vram));
            }
        }
    }

    map
}

#[cfg(target_os = "linux")]
fn query_lspci_name_for_slot(slot: &str) -> Option<String> {
    let output = std::process::Command::new("lspci")
        .arg("-s")
        .arg(slot)
        .output()
        .ok()?;

    if !output.status.success() {
        return None;
    }

    let line = String::from_utf8_lossy(&output.stdout)
        .lines()
        .next()?
        .trim()
        .to_string();

    let without_slot = line
        .strip_prefix(slot)
        .map(|s| s.trim_start().to_string())
        .unwrap_or(line);

    if without_slot.is_empty() {
        None
    } else {
        Some(without_slot)
    }
}

#[cfg(target_os = "linux")]
fn get_gpus_linux() -> Vec<GpuInfo> {
    let mut gpus = Vec::new();
    let nvidia_meta = query_nvidia_meta_by_bus();
    let rocm_driver = check_rocm_driver();
    let mut seen_bus_ids = std::collections::HashSet::<String>::new();

    let Ok(entries) = std::fs::read_dir("/sys/class/drm") else {
        return gpus;
    };

    for entry in entries.flatten() {
        let path = entry.path();
        let name = path
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .to_string();

        // Canonical Linux probe: only cardN devices (skip render nodes and connectors).
        let is_card = name.starts_with("card")
            && !name.contains('-')
            && name.len() > 4
            && name[4..].chars().all(|c| c.is_ascii_digit());
        if !is_card {
            continue;
        }

        let class_hex = std::fs::read_to_string(path.join("device/class"))
            .ok()
            .map(|s| s.trim().to_lowercase())
            .unwrap_or_default();
        if !class_hex.starts_with("0x03") {
            // Exclude non-display PCI functions accidentally exposed via DRM.
            continue;
        }

        let uevent = std::fs::read_to_string(path.join("device/uevent")).ok();
        let slot_raw = uevent.as_ref().and_then(|u| {
            u.lines()
                .find(|l| l.starts_with("PCI_SLOT_NAME="))
                .map(|l| l.trim_start_matches("PCI_SLOT_NAME=").trim().to_string())
        });
        let slot_norm = slot_raw
            .as_deref()
            .map(normalize_pci_bus_id)
            .unwrap_or_default();
        if !slot_norm.is_empty() {
            if seen_bus_ids.contains(&slot_norm) {
                continue;
            }
            seen_bus_ids.insert(slot_norm.clone());
        }

        let driver_name = std::fs::read_link(path.join("device/driver"))
            .ok()
            .and_then(|p| p.file_name().map(|n| n.to_string_lossy().to_string()))
            .unwrap_or_else(|| "unknown".to_string());

        let vendor_hex = std::fs::read_to_string(path.join("device/vendor"))
            .ok()
            .map(|s| s.trim().to_lowercase())
            .unwrap_or_default();
        let pci_id = uevent.as_ref().and_then(|u| {
            u.lines()
                .find(|l| l.starts_with("PCI_ID="))
                .map(|l| l.trim_start_matches("PCI_ID=").to_string())
        });

        let mut runtime = match driver_name.as_str() {
            "nvidia" => "cuda",
            "amdgpu" | "radeon" => {
                if rocm_driver.is_available {
                    "rocm"
                } else {
                    "vulkan"
                }
            }
            "i915" | "xe" | "intel" | "nouveau" => "vulkan",
            _ => "vulkan",
        }
        .to_string();

        // If NVIDIA metadata is absent, degrade runtime to Vulkan as a safer default.
        let nvidia_entry = if !slot_norm.is_empty() {
            nvidia_meta.get(&slot_norm)
        } else {
            None
        };
        if driver_name == "nvidia" && nvidia_entry.is_none() {
            runtime = "vulkan".to_string();
        }

        let mut device_name = slot_raw
            .as_deref()
            .and_then(query_lspci_name_for_slot)
            .unwrap_or_default();

        let mut vram_mb: Option<u64> = None;
        if let Some((nvidia_name, nvidia_vram)) = nvidia_entry {
            if device_name.is_empty() {
                device_name = nvidia_name.clone();
            }
            vram_mb = *nvidia_vram;
        }

        if device_name.is_empty() {
            device_name = match vendor_hex.as_str() {
                "0x10de" => "NVIDIA GPU".to_string(),
                "0x1002" => pci_id
                    .as_ref()
                    .map(|id| format!("AMD GPU ({id})"))
                    .unwrap_or_else(|| "AMD GPU".to_string()),
                "0x8086" => "Intel Graphics".to_string(),
                _ => pci_id
                    .as_ref()
                    .map(|id| format!("GPU ({id})"))
                    .unwrap_or_else(|| "Unknown GPU".to_string()),
            };
        }

        if vram_mb.is_none() {
            vram_mb = std::fs::read_to_string(path.join("device/mem_info_vram_total"))
                .ok()
                .and_then(|s| s.trim().parse::<u64>().ok())
                .map(|bytes| bytes / (1024 * 1024));
        }

        gpus.push(GpuInfo {
            id: format!("{}:{}", runtime, gpus.len()),
            name: device_name,
            gpu_type: runtime.clone(),
            vram_mb,
            available_vram_mb: None,
            is_available: true,
            driver: DriverStatus {
                driver_type: runtime,
                is_available: true,
                version: None,
                error: None,
            },
        });
    }

    gpus
}

/// Get list of available NPUs
pub fn get_npus() -> Vec<NpuInfo> {
    let mut npus = Vec::new();

    // Check for Intel NPU (Meteor Lake and later)
    #[cfg(target_os = "linux")]
    {
        let xrt_present = [
            "/usr/lib/libxrt_coreutil.so",
            "/usr/lib/x86_64-linux-gnu/libxrt_coreutil.so",
            "/usr/lib/aarch64-linux-gnu/libxrt_coreutil.so",
        ]
        .iter()
        .any(|p| std::path::Path::new(p).exists());
        let flm_present = std::process::Command::new("sh")
            .arg("-c")
            .arg("command -v flm >/dev/null 2>&1")
            .status()
            .map(|s| s.success())
            .unwrap_or(false);

        let mut seen = std::collections::HashSet::<String>::new();
        if let Ok(entries) = std::fs::read_dir("/sys/class/accel") {
            for entry in entries.flatten() {
                let p = entry.path();
                let name = p
                    .file_name()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .to_string();
                if !name.starts_with("accel") {
                    continue;
                }

                let driver_name = std::fs::read_link(p.join("device/driver"))
                    .ok()
                    .and_then(|l| l.file_name().map(|n| n.to_string_lossy().to_string()))
                    .unwrap_or_else(|| "unknown".to_string());
                let vendor = std::fs::read_to_string(p.join("device/vendor"))
                    .ok()
                    .map(|s| s.trim().to_lowercase())
                    .unwrap_or_default();

                let (npu_name, npu_type, driver_type) =
                    if driver_name.contains("amdxdna") || vendor == "0x1022" {
                        ("AMD XDNA NPU", "amd_xdna", "xdna2")
                    } else if driver_name.contains("intel")
                        || driver_name.contains("vpu")
                        || vendor == "0x8086"
                    {
                        ("Intel NPU", "intel_npu", "intel_npu")
                    } else {
                        ("NPU", "generic_npu", "npu")
                    };

                let dedupe_key = format!("{}:{}", npu_type, driver_name);
                if seen.contains(&dedupe_key) {
                    continue;
                }
                seen.insert(dedupe_key);

                let (is_available, error) = if npu_type == "amd_xdna" {
                    let setup_ok = xrt_present && flm_present;
                    (
                        setup_ok,
                        if setup_ok {
                            None
                        } else {
                            Some(
                                "AMD NPU detected but setup is incomplete (requires XRT + FastFlowLM)"
                                    .to_string(),
                            )
                        },
                    )
                } else {
                    (true, None)
                };

                npus.push(NpuInfo {
                    name: npu_name.to_string(),
                    npu_type: npu_type.to_string(),
                    is_available,
                    driver: DriverStatus {
                        driver_type: driver_type.to_string(),
                        is_available,
                        version: None,
                        error,
                    },
                });
            }
        }

        // Legacy fallback for Intel systems exposing /dev/accel without class entries.
        if npus.is_empty() && std::path::Path::new("/dev/accel/accel0").exists() {
            npus.push(NpuInfo {
                name: "Intel NPU".to_string(),
                npu_type: "intel_npu".to_string(),
                is_available: true,
                driver: DriverStatus {
                    driver_type: "intel_npu".to_string(),
                    is_available: true,
                    version: None,
                    error: None,
                },
            });
        }
    }

    // Check for Apple Neural Engine (macOS)
    #[cfg(target_os = "macos")]
    {
        npus.push(NpuInfo {
            name: "Apple Neural Engine".to_string(),
            npu_type: "apple_neural_engine".to_string(),
            is_available: true,
            driver: DriverStatus {
                driver_type: "coreml".to_string(),
                is_available: true,
                version: None,
                error: None,
            },
        });
    }

    npus
}

/// Get complete system resources information
pub fn get_system_resources() -> SystemResources {
    let cpu = get_cpu_info();
    let memory = get_memory_info();
    let gpus = get_gpus();
    let npus = get_npus();

    // Collect all driver statuses
    let mut drivers = vec![
        check_cuda_driver(),
        check_vulkan_driver(),
        check_rocm_driver(),
        check_metal_driver(),
    ];

    // Add NPU drivers
    for npu in &npus {
        drivers.push(npu.driver.clone());
    }

    SystemResources {
        cpu,
        memory,
        gpus,
        npus,
        drivers,
    }
}

/// Get real-time utilization metrics for CPU/GPU and memory.
pub fn get_system_usage() -> SystemUsage {
    let mut cpu_sys =
        System::new_with_specifics(RefreshKind::nothing().with_cpu(CpuRefreshKind::everything()));
    cpu_sys.refresh_cpu_all();
    std::thread::sleep(sysinfo::MINIMUM_CPU_UPDATE_INTERVAL);
    cpu_sys.refresh_cpu_all();
    let cpu_utilization_percent = if cpu_sys.cpus().is_empty() {
        None
    } else {
        let total: f32 = cpu_sys.cpus().iter().map(|c| c.cpu_usage()).sum();
        Some(total / cpu_sys.cpus().len() as f32)
    };

    let memory_usage_percent = get_memory_info().usage_percent;

    let mut gpus: Vec<GpuUsage> = get_gpus()
        .into_iter()
        .map(|gpu| {
            let memory_used_mb = match (gpu.vram_mb, gpu.available_vram_mb) {
                (Some(total), Some(available)) => Some(total.saturating_sub(available)),
                _ => None,
            };
            GpuUsage {
                id: gpu.id,
                utilization_percent: None,
                memory_total_mb: gpu.vram_mb,
                memory_used_mb,
            }
        })
        .collect();

    for snapshot in query_platform_gpu_usage() {
        merge_gpu_usage(&mut gpus, snapshot);
    }

    let timestamp_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .ok()
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);

    let npu_utilization_percent = query_npu_utilization();

    SystemUsage {
        cpu_utilization_percent,
        memory_usage_percent,
        gpus,
        npu_utilization_percent,
        timestamp_ms,
    }
}

/// Try to read NPU busy percentage from platform-specific sources.
fn query_npu_utilization() -> Option<f32> {
    #[cfg(target_os = "linux")]
    {
        // Intel NPU (Meteor Lake+): /sys/class/accel/accel*/device/busy_percent or busy_percent
        let accel_paths = [
            "/sys/class/accel/accel0/device/busy_percent",
            "/sys/class/accel/accel0/busy_percent",
            "/sys/class/accel/accel1/device/busy_percent",
        ];
        for path in &accel_paths {
            if let Ok(s) = std::fs::read_to_string(path) {
                if let Ok(v) = s.trim().parse::<f32>() {
                    return Some(v.clamp(0.0, 100.0));
                }
            }
        }
    }
    // macOS / Windows: no standard sysfs equivalent; return None
    None
}

/// Get mounted disks/volumes and storage device capacity.
pub fn get_storage_devices() -> Vec<StorageDevice> {
    let disks = Disks::new_with_refreshed_list();
    disks
        .list()
        .iter()
        .map(|disk| {
            let total = disk.total_space() / (1024 * 1024);
            let available = disk.available_space() / (1024 * 1024);
            let used = total.saturating_sub(available);
            let usage_percent = if total > 0 {
                (used as f64 / total as f64 * 100.0) as f32
            } else {
                0.0
            };
            StorageDevice {
                name: disk.name().to_string_lossy().to_string(),
                mount_point: disk.mount_point().to_string_lossy().to_string(),
                file_system: disk.file_system().to_string_lossy().to_string(),
                kind: disk.kind().to_string(),
                total_mb: total,
                available_mb: available,
                used_mb: used,
                usage_percent,
                is_removable: disk.is_removable(),
            }
        })
        .collect()
}

/// Get OS/system/CPU/user identity metadata.
pub fn get_system_identity() -> SystemIdentity {
    let cpu = get_cpu_info();
    let user_name = std::env::var("USER")
        .ok()
        .or_else(|| std::env::var("USERNAME").ok());

    SystemIdentity {
        os_name: System::name(),
        os_version: System::os_version(),
        kernel_version: System::kernel_version(),
        host_name: System::host_name(),
        uptime_secs: System::uptime(),
        boot_time_secs: System::boot_time(),
        user_name,
        cpu_name: cpu.name,
        cpu_arch: cpu.arch,
        cpu_physical_cores: cpu.physical_cores,
        cpu_logical_cores: cpu.logical_cores,
    }
}

fn merge_gpu_usage(gpus: &mut Vec<GpuUsage>, incoming: GpuUsage) {
    if let Some(existing) = gpus.iter_mut().find(|g| g.id == incoming.id) {
        existing.utilization_percent = incoming
            .utilization_percent
            .or(existing.utilization_percent);
        existing.memory_total_mb = incoming.memory_total_mb.or(existing.memory_total_mb);
        existing.memory_used_mb = incoming.memory_used_mb.or(existing.memory_used_mb);
        return;
    }
    gpus.push(incoming);
}

fn query_platform_gpu_usage() -> Vec<GpuUsage> {
    #[cfg(target_os = "linux")]
    {
        return query_linux_gpu_usage();
    }
    #[cfg(target_os = "windows")]
    {
        return query_windows_gpu_usage();
    }
    #[cfg(target_os = "macos")]
    {
        return query_macos_gpu_usage();
    }
    #[allow(unreachable_code)]
    Vec::new()
}

#[cfg(target_os = "linux")]
fn query_linux_gpu_usage() -> Vec<GpuUsage> {
    let mut out = Vec::new();
    out.extend(query_linux_amd_sysfs_usage());
    out.extend(query_linux_intel_sysfs_usage());
    out.extend(query_nvidia_smi_usage());
    out
}

#[cfg(target_os = "linux")]
fn query_linux_amd_sysfs_usage() -> Vec<GpuUsage> {
    let mut out = Vec::new();
    if let Ok(entries) = std::fs::read_dir("/sys/class/drm") {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if !name.starts_with("card") || name.contains('-') {
                continue;
            }
            let card_path = entry.path();
            let device_path = card_path.join("device");
            let vendor = read_trimmed(device_path.join("vendor"));
            if vendor.as_deref() != Some("0x1002") {
                continue;
            }

            let util = read_trimmed(device_path.join("gpu_busy_percent"))
                .and_then(|s| s.parse::<f32>().ok());
            let total_bytes = read_trimmed(device_path.join("mem_info_vram_total"))
                .and_then(|s| s.parse::<u64>().ok());
            let used_bytes = read_trimmed(device_path.join("mem_info_vram_used"))
                .and_then(|s| s.parse::<u64>().ok());

            let memory_total_mb = total_bytes.map(|b| b / (1024 * 1024));
            let memory_used_mb = used_bytes.map(|b| b / (1024 * 1024));

            out.push(GpuUsage {
                id: format!("amd:{}", name),
                utilization_percent: util,
                memory_total_mb,
                memory_used_mb,
            });
        }
    }
    out
}

#[cfg(target_os = "linux")]
fn query_linux_intel_sysfs_usage() -> Vec<GpuUsage> {
    let mut out = Vec::new();
    if let Ok(entries) = std::fs::read_dir("/sys/class/drm") {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if !name.starts_with("card") || name.contains('-') {
                continue;
            }
            let card_path = entry.path();
            let device_path = card_path.join("device");
            let vendor = read_trimmed(device_path.join("vendor"));
            if vendor.as_deref() != Some("0x8086") {
                continue;
            }

            let util = read_trimmed(device_path.join("gpu_busy_percent"))
                .and_then(|s| s.parse::<f32>().ok());
            out.push(GpuUsage {
                id: format!("intel:{}", name),
                utilization_percent: util,
                memory_total_mb: None,
                memory_used_mb: None,
            });
        }
    }
    out
}

fn query_nvidia_smi_usage() -> Vec<GpuUsage> {
    let mut out = Vec::new();
    let binaries = ["nvidia-smi", "/usr/bin/nvidia-smi", "/bin/nvidia-smi"];
    for bin in binaries {
        if let Ok(output) = std::process::Command::new(bin)
            .arg("--query-gpu=utilization.gpu,memory.total,memory.used")
            .arg("--format=csv,noheader,nounits")
            .output()
        {
            if output.status.success() {
                let rows = String::from_utf8_lossy(&output.stdout).trim().to_string();
                for (idx, row) in rows.lines().enumerate() {
                    let mut parts = row.split(',').map(|s| s.trim());
                    let utilization_percent = parts.next().and_then(|v| v.parse::<f32>().ok());
                    let memory_total_mb = parts.next().and_then(|v| v.parse::<u64>().ok());
                    let memory_used_mb = parts.next().and_then(|v| v.parse::<u64>().ok());
                    out.push(GpuUsage {
                        id: format!("cuda:{}", idx),
                        utilization_percent,
                        memory_total_mb,
                        memory_used_mb,
                    });
                }
                if !out.is_empty() {
                    return out;
                }
            }
        }
    }
    out
}

#[cfg(target_os = "windows")]
fn query_windows_gpu_usage() -> Vec<GpuUsage> {
    // This path runs from the global 1s telemetry loop. On Windows, avoid
    // spawning visible PowerShell windows continuously and throttle expensive
    // external probes to a coarser interval.
    if let Ok(cache) = WINDOWS_GPU_USAGE_CACHE.lock() {
        if let Some(last) = cache.0 {
            if last.elapsed() < WINDOWS_GPU_USAGE_TTL {
                return cache.1.clone();
            }
        }
    }

    let mut out = Vec::new();
    let controller_script = r#"
      $list = Get-CimInstance Win32_VideoController | Select-Object Name,AdapterRAM
      $list | ConvertTo-Json -Compress
    "#;
    if let Some(output) =
        run_windows_command_hidden("powershell", &["-NoProfile", "-Command", controller_script])
    {
        if output.status.success() {
            let txt = String::from_utf8_lossy(&output.stdout);
            if let Ok(value) = serde_json::from_str::<serde_json::Value>(&txt) {
                if let Some(items) = value.as_array() {
                    for (idx, item) in items.iter().enumerate() {
                        let adapter_ram = item.get("AdapterRAM").and_then(|v| v.as_u64());
                        out.push(GpuUsage {
                            id: format!("windows:gpu{}", idx),
                            utilization_percent: None,
                            memory_total_mb: adapter_ram.map(|b| b / (1024 * 1024)),
                            memory_used_mb: None,
                        });
                    }
                }
            }
        }
    }

    let util_script = r#"
      $samples = (Get-Counter '\GPU Engine(*)\Utilization Percentage').CounterSamples
      $sum = ($samples | Measure-Object -Property CookedValue -Sum).Sum
      if ($null -eq $sum) { $sum = 0 }
      [PSCustomObject]@{util=$sum} | ConvertTo-Json -Compress
    "#;
    if let Some(output) =
        run_windows_command_hidden("powershell", &["-NoProfile", "-Command", util_script])
    {
        if output.status.success() {
            let txt = String::from_utf8_lossy(&output.stdout);
            if let Ok(value) = serde_json::from_str::<serde_json::Value>(&txt) {
                let util = value.get("util").and_then(|v| v.as_f64()).map(|v| v as f32);
                if let Some(first) = out.get_mut(0) {
                    first.utilization_percent = util;
                } else if util.is_some() {
                    out.push(GpuUsage {
                        id: "windows:gpu0".to_string(),
                        utilization_percent: util,
                        memory_total_mb: None,
                        memory_used_mb: None,
                    });
                }
            }
        }
    }

    if let Ok(mut cache) = WINDOWS_GPU_USAGE_CACHE.lock() {
        cache.0 = Some(Instant::now());
        cache.1 = out.clone();
    }

    out
}

#[cfg(target_os = "macos")]
fn query_macos_gpu_usage() -> Vec<GpuUsage> {
    let mut out = Vec::new();
    if let Ok(output) = std::process::Command::new("system_profiler")
        .arg("SPDisplaysDataType")
        .arg("-json")
        .output()
    {
        if output.status.success() {
            let txt = String::from_utf8_lossy(&output.stdout);
            if let Ok(value) = serde_json::from_str::<serde_json::Value>(&txt) {
                if let Some(displays) = value.get("SPDisplaysDataType").and_then(|v| v.as_array()) {
                    for (idx, gpu) in displays.iter().enumerate() {
                        let total_mb = gpu
                            .get("spdisplays_vram")
                            .and_then(|v| v.as_str())
                            .and_then(parse_macos_memory_mb)
                            .or_else(|| {
                                gpu.get("spdisplays_vram_shared")
                                    .and_then(|v| v.as_str())
                                    .and_then(parse_macos_memory_mb)
                            });
                        out.push(GpuUsage {
                            id: format!("macos:gpu{}", idx),
                            utilization_percent: None,
                            memory_total_mb: total_mb,
                            memory_used_mb: None,
                        });
                    }
                }
            }
        }
    }
    out
}

#[cfg(target_os = "macos")]
fn parse_macos_memory_mb(value: &str) -> Option<u64> {
    let lower = value.to_lowercase();
    let num = lower
        .split_whitespace()
        .find_map(|p| p.trim().parse::<f64>().ok())?;
    if lower.contains("tb") {
        return Some((num * 1024.0 * 1024.0) as u64);
    }
    if lower.contains("gb") {
        return Some((num * 1024.0) as u64);
    }
    if lower.contains("mb") {
        return Some(num as u64);
    }
    None
}

#[cfg(target_os = "linux")]
fn read_trimmed(path: std::path::PathBuf) -> Option<String> {
    std::fs::read_to_string(path)
        .ok()
        .map(|s| s.trim().to_string())
}

/// Check if llama.cpp server binary is available in PATH
fn check_llama_cpp_binary() -> Option<(String, Option<String>)> {
    // Common binary names for llama.cpp
    let binary_names = ["llama-server", "llama.cpp", "main", "llama-cli"];

    // Check if binary is in PATH
    for binary in &binary_names {
        #[cfg(target_os = "windows")]
        let lookup = run_windows_command_hidden("where", &[*binary]).ok_or(());
        #[cfg(not(target_os = "windows"))]
        let lookup = std::process::Command::new("which")
            .arg(binary)
            .output()
            .map_err(|_| ());
        if let Ok(output) = lookup {
            if output.status.success() {
                let path = String::from_utf8_lossy(&output.stdout)
                    .lines()
                    .next()
                    .map(|s| s.trim().to_string())
                    .unwrap_or_default();
                if !path.is_empty() {
                    // Try to get version
                    let version = std::process::Command::new(&path)
                        .arg("--version")
                        .output()
                        .ok()
                        .and_then(|v| {
                            let v_str = String::from_utf8_lossy(&v.stdout);
                            v_str.lines().next().map(|s| s.to_string())
                        });
                    return Some((path, version));
                }
            }
        }
    }

    None
}

/// Check if a specific engine binary has been installed to the engines directory
fn check_installed_binary(
    engine_id: &str,
    engines_dir: Option<&std::path::Path>,
) -> Option<String> {
    let dir = engines_dir?;
    super::engine_installer::find_engine_binary(engine_id, dir)
        .map(|p| p.to_string_lossy().to_string())
}

/// Get the compiled backend type
fn get_compiled_backend() -> &'static str {
    #[cfg(feature = "vulkan")]
    {
        "vulkan"
    }
    #[cfg(feature = "cuda")]
    {
        "cuda"
    }
    #[cfg(feature = "metal")]
    {
        "metal"
    }
    #[cfg(feature = "rocm")]
    {
        "rocm"
    }
    #[cfg(not(any(
        feature = "vulkan",
        feature = "cuda",
        feature = "metal",
        feature = "rocm"
    )))]
    {
        "cpu"
    }
}

/// Get list of compatible inference engines for this system.
///
/// `engines_dir` — path to the directory where engines are installed by the
/// in-app installer (e.g. `{app_data_dir}/engines`).  Pass `None` to skip
/// the installed-binary check.
pub fn get_compatible_engines(engines_dir: Option<&std::path::Path>) -> Vec<InferenceEngine> {
    let mut engines = Vec::new();
    let compiled_backend = get_compiled_backend();
    let os = std::env::consts::OS;

    // For GPU-specific engines: ONLY use an explicitly installed binary from the engines
    // directory.  Do NOT fall back to any llama-server found in PATH.
    // A CPU-only binary run with --ngl 999 will load all model weights into system RAM
    // and crash the system — the root cause of the OOM hang described in the bug report.
    let find_gpu_binary = |engine_id: &str| -> Option<(String, Option<String>)> {
        check_installed_binary(engine_id, engines_dir).map(|path| (path, None))
    };

    // For the CPU engine: PATH fallback is safe because every llama-server build
    // supports CPU inference.
    let find_binary = |engine_id: &str| -> Option<(String, Option<String>)> {
        if let Some(installed) = check_installed_binary(engine_id, engines_dir) {
            return Some((installed, None));
        }
        check_llama_cpp_binary()
    };

    // ── Vulkan (recommended for AMD GPUs) ──────────────────────────────────
    let vulkan_driver = check_vulkan_driver();
    let has_amd_gpu = check_for_amd_gpu();
    let vulkan_applicable = matches!(os, "linux" | "windows");
    {
        let engine_id = "llama.cpp-vulkan";
        let binary_info = find_gpu_binary(engine_id);
        let is_compiled = compiled_backend == "vulkan";
        let has_binary = binary_info.is_some();
        let version = binary_info.as_ref().and_then(|(_, v)| v.clone());
        let binary_path = binary_info.map(|(p, _)| p);
        let is_available = vulkan_applicable && (is_compiled || has_binary);
        let error = if !vulkan_applicable {
            Some("Not applicable on this platform".to_string())
        } else if !is_compiled && !has_binary {
            Some("Not installed — click Download to install".to_string())
        } else if !vulkan_driver.is_available && !is_compiled {
            Some("Vulkan driver not detected".to_string())
        } else {
            None
        };
        engines.push(InferenceEngine {
            id: engine_id.to_string(),
            name: "llama.cpp (Vulkan)".to_string(),
            engine_type: "llama.cpp".to_string(),
            backend: "vulkan".to_string(),
            is_available,
            is_applicable: vulkan_applicable,
            is_recommended: vulkan_applicable && has_amd_gpu,
            version,
            binary_path,
            error,
        });
    }

    // ── CUDA (recommended for NVIDIA GPUs) ────────────────────────────────
    let cuda_driver = check_cuda_driver();
    let has_nvidia_gpu = check_for_nvidia_gpu();
    let cuda_applicable = matches!(os, "linux" | "windows");
    {
        let engine_id = "llama.cpp-cuda";
        let binary_info = find_gpu_binary(engine_id);
        let is_compiled = compiled_backend == "cuda";
        let has_binary = binary_info.is_some();
        let version = binary_info.as_ref().and_then(|(_, v)| v.clone());
        let binary_path = binary_info.map(|(p, _)| p);
        let is_available = cuda_applicable && (is_compiled || has_binary);
        let error = if !cuda_applicable {
            Some("Not applicable on this platform".to_string())
        } else if !is_compiled && !has_binary {
            Some("Not installed — click Download to install".to_string())
        } else if !cuda_driver.is_available && !is_compiled {
            Some("CUDA driver not detected".to_string())
        } else {
            None
        };
        engines.push(InferenceEngine {
            id: engine_id.to_string(),
            name: "llama.cpp (CUDA)".to_string(),
            engine_type: "llama.cpp".to_string(),
            backend: "cuda".to_string(),
            is_available,
            is_applicable: cuda_applicable,
            is_recommended: cuda_applicable && has_nvidia_gpu,
            version,
            binary_path,
            error,
        });
    }

    // ── ROCm (alternative for AMD GPUs) ───────────────────────────────────
    let rocm_driver = check_rocm_driver();
    let rocm_applicable = matches!(os, "linux" | "windows");
    {
        let engine_id = "llama.cpp-rocm";
        let binary_info = find_gpu_binary(engine_id);
        let is_compiled = compiled_backend == "rocm";
        let has_binary = binary_info.is_some();
        let version = binary_info.as_ref().and_then(|(_, v)| v.clone());
        let binary_path = binary_info.map(|(p, _)| p);
        let is_available = rocm_applicable && (is_compiled || has_binary);
        let error = if !rocm_applicable {
            Some("Not applicable on this platform".to_string())
        } else if !is_compiled && !has_binary {
            Some("Not installed — click Download to install".to_string())
        } else if !rocm_driver.is_available && !is_compiled {
            Some("ROCm driver not detected".to_string())
        } else {
            None
        };
        engines.push(InferenceEngine {
            id: engine_id.to_string(),
            name: "llama.cpp (ROCm)".to_string(),
            engine_type: "llama.cpp".to_string(),
            backend: "rocm".to_string(),
            is_available,
            is_applicable: rocm_applicable,
            is_recommended: rocm_applicable && has_amd_gpu && !vulkan_driver.is_available,
            version,
            binary_path,
            error,
        });
    }

    // ── Metal (macOS only) ────────────────────────────────────────────────
    let metal_applicable = matches!(os, "macos" | "ios");
    {
        let engine_id = "llama.cpp-metal";
        let binary_info = find_gpu_binary(engine_id);
        let is_compiled = compiled_backend == "metal";
        let has_binary = binary_info.is_some();
        let version = binary_info.as_ref().and_then(|(_, v)| v.clone());
        let binary_path = binary_info.map(|(p, _)| p);
        let is_available = metal_applicable && (is_compiled || has_binary);
        let error = if !metal_applicable {
            Some("Not applicable on this platform".to_string())
        } else if !is_compiled && !has_binary {
            Some("Not installed — click Download to install".to_string())
        } else {
            None
        };
        engines.push(InferenceEngine {
            id: engine_id.to_string(),
            name: "llama.cpp (Metal)".to_string(),
            engine_type: "llama.cpp".to_string(),
            backend: "metal".to_string(),
            is_available,
            is_applicable: metal_applicable,
            is_recommended: metal_applicable,
            version,
            binary_path,
            error,
        });
    }

    // ── CPU fallback (always shown) ───────────────────────────────────────
    {
        let engine_id = "llama.cpp-cpu";
        let binary_info = find_binary(engine_id);
        let version = binary_info.as_ref().and_then(|(_, v)| v.clone());
        let binary_path = binary_info.map(|(p, _)| p);
        engines.push(InferenceEngine {
            id: engine_id.to_string(),
            name: "llama.cpp (CPU)".to_string(),
            engine_type: "llama.cpp".to_string(),
            backend: "cpu".to_string(),
            is_available: true,
            is_applicable: true,
            is_recommended: !engines.iter().any(|e| e.is_recommended),
            version,
            binary_path,
            error: None,
        });
    }

    engines
}

/// Check if system has an AMD GPU
fn check_for_amd_gpu() -> bool {
    // Check via vulkaninfo for AMD
    if let Ok(output) = std::process::Command::new("vulkaninfo")
        .arg("--summary")
        .output()
    {
        let info = String::from_utf8_lossy(&output.stdout);
        if info.to_lowercase().contains("amd") || info.to_lowercase().contains("radeon") {
            return true;
        }
    }

    // Check via lspci on Linux
    #[cfg(target_os = "linux")]
    {
        if let Ok(output) = std::process::Command::new("lspci").output() {
            let pci_info = String::from_utf8_lossy(&output.stdout);
            if pci_info.to_lowercase().contains("amd") && pci_info.to_lowercase().contains("vga") {
                return true;
            }
            if pci_info.to_lowercase().contains("radeon") {
                return true;
            }
        }
    }

    false
}

/// Check if system has an NVIDIA GPU
fn check_for_nvidia_gpu() -> bool {
    // Check via nvidia-smi
    if std::process::Command::new("nvidia-smi")
        .arg("--query-gpu=name")
        .arg("--format=csv,noheader")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
    {
        return true;
    }

    // Check via lspci on Linux
    #[cfg(target_os = "linux")]
    {
        if let Ok(output) = std::process::Command::new("lspci").output() {
            let pci_info = String::from_utf8_lossy(&output.stdout);
            if pci_info.to_lowercase().contains("nvidia") {
                return true;
            }
        }
    }

    false
}

/// Get runtime status with all compatible engines.
///
/// `engines_dir` — optional path to the installed-engines directory (see
/// `get_compatible_engines`).
pub fn get_runtime_status(engines_dir: Option<&std::path::Path>) -> RuntimeStatus {
    let engines = get_compatible_engines(engines_dir);
    let has_available = engines.iter().any(|e| e.is_available);

    // Determine the active engine based on compiled backend
    let compiled_backend = get_compiled_backend();
    let active_engine = engines
        .iter()
        .find(|e| e.backend == compiled_backend && e.is_available)
        .map(|e| e.id.clone());

    // Generate warning if no engines are available
    let warning = if !has_available {
        Some("No inference engines are available. Please install llama.cpp or ensure GPU drivers are properly configured.".to_string())
    } else if !engines.iter().any(|e| e.is_available && e.backend != "cpu") {
        Some("Only CPU inference is available. For better performance, consider installing GPU drivers (Vulkan for AMD, CUDA for NVIDIA).".to_string())
    } else {
        None
    };

    RuntimeStatus {
        engines,
        active_engine,
        has_available_engine: has_available,
        warning,
    }
}

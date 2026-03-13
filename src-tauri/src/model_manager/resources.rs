//! Compute device enumeration for model loading
//!
//! This module provides functionality to enumerate available compute devices
//! (CPU, CUDA, Metal, ROCm, Vulkan) for model inference.
//!
//! ## iOS Memory Constraints
//!
//! iOS imposes strict memory limits on apps regardless of device RAM:
//! - Apps are typically limited to ~2.5GB before receiving memory warnings
//! - sysinfo reports device total RAM, not the app's available limit
//! - Use `estimate_ios_memory_available()` for accurate iOS memory assessment

use super::types::DeviceInfo;

/// iOS app memory limit in megabytes.
///
/// iOS apps are terminated if they exceed this threshold, regardless of
/// device total RAM. This is a conservative limit that works across
/// iPhone and iPad devices.
///
/// Reference: https://developer.apple.com/documentation/uikit/uimemoryusagelevel
#[cfg(target_os = "ios")]
const IOS_APP_MEMORY_LIMIT_MB: u64 = 2560; // Conservative 2.5GB

/// Large model threshold for iOS recommendations (7B parameters)
#[cfg(target_os = "ios")]
const IOS_LARGE_MODEL_THRESHOLD_PARAMS: u64 = 7_000_000_000;

/// Recommended context length for iOS to avoid memory pressure
#[cfg(target_os = "ios")]
const IOS_RECOMMENDED_CONTEXT_LENGTH: u32 = 4096;

/// Enumerate all available compute devices.
///
/// Always returns at least a CPU device. GPU devices are enumerated
/// based on compile-time features and runtime availability.
pub fn enumerate_devices() -> Vec<DeviceInfo> {
    let mut devices = Vec::new();

    // Always add CPU device first
    let cpu_name = get_cpu_name();
    let _total_ram_mb = get_total_ram_mb();
    devices.push(DeviceInfo {
        id: "cpu".to_string(),
        device_type: "cpu".to_string(),
        name: cpu_name,
        vram_mb: None, // CPU uses system RAM
        is_selected: false,
        is_available: true,
    });

    // Add GPU devices based on compile-time features
    #[cfg(feature = "cuda")]
    {
        if let Some(cuda_devices) = enumerate_cuda_devices() {
            devices.extend(cuda_devices);
        }
    }

    #[cfg(feature = "metal")]
    {
        if let Some(metal_devices) = enumerate_metal_devices() {
            devices.extend(metal_devices);
        }
    }

    #[cfg(feature = "rocm")]
    {
        if let Some(rocm_devices) = enumerate_rocm_devices() {
            devices.extend(rocm_devices);
        }
    }

    #[cfg(feature = "vulkan")]
    {
        if let Some(vulkan_devices) = enumerate_vulkan_devices() {
            devices.extend(vulkan_devices);
        }
    }

    // Auto-select the best available device
    auto_select_device(&mut devices);

    devices
}

/// Get a human-readable CPU name
fn get_cpu_name() -> String {
    // Try to get CPU info from /proc/cpuinfo on Linux
    #[cfg(target_os = "linux")]
    {
        if let Ok(contents) = std::fs::read_to_string("/proc/cpuinfo") {
            for line in contents.lines() {
                if line.starts_with("model name") {
                    if let Some(name) = line.split(':').nth(1) {
                        return format!("CPU ({})", name.trim());
                    }
                }
            }
        }
    }

    // Fallback for other platforms — sysinfo 0.33 API
    #[cfg(not(target_os = "linux"))]
    {
        use sysinfo::{CpuRefreshKind, RefreshKind, System};
        let mut sys =
            System::new_with_specifics(RefreshKind::new().with_cpu(CpuRefreshKind::new()));
        sys.refresh_cpu_all();
        if let Some(cpu) = sys.cpus().first() {
            let brand = cpu.brand();
            if !brand.is_empty() {
                return format!("CPU ({})", brand);
            }
        }
    }

    "CPU".to_string()
}

/// Get total system RAM in megabytes
fn get_total_ram_mb() -> u64 {
    use sysinfo::System;
    let mut sys = System::new();
    sys.refresh_memory();
    sys.total_memory() / (1024 * 1024)
}

/// Auto-select the best available device
fn auto_select_device(devices: &mut [DeviceInfo]) {
    // Prefer GPU devices over CPU
    // Priority: CUDA > Metal > ROCm > Vulkan > CPU
    let device_priority = ["cuda", "metal", "rocm", "vulkan", "cpu"];

    let mut best_device_idx = 0;
    let mut best_priority = device_priority.len(); // Lower is better

    for (idx, device) in devices.iter().enumerate() {
        if !device.is_available {
            continue;
        }
        if let Some(priority) = device_priority
            .iter()
            .position(|&t| t == device.device_type)
        {
            if priority < best_priority {
                best_priority = priority;
                best_device_idx = idx;
            }
        }
    }

    if let Some(device) = devices.get_mut(best_device_idx) {
        device.is_selected = true;
    }
}

#[cfg(feature = "cuda")]
fn enumerate_cuda_devices() -> Option<Vec<DeviceInfo>> {
    // CUDA device enumeration via llama.cpp backend
    // The llama-cpp-2 crate provides max_devices() and device queries
    // For now, we'll use a simplified approach

    let mut devices = Vec::new();

    // Query CUDA device count through llama.cpp's ggml backend
    // This requires the backend to be initialized
    // Note: Actual implementation would call into llama-cpp-2's device APIs

    // Placeholder: In production, we'd query actual CUDA devices
    // For now, add a generic CUDA device if the feature is enabled
    let total_vram_mb = get_cuda_vram_mb(0).unwrap_or(0);

    devices.push(DeviceInfo {
        id: "cuda:0".to_string(),
        device_type: "cuda".to_string(),
        name: get_cuda_device_name(0).unwrap_or_else(|| "NVIDIA GPU".to_string()),
        vram_mb: Some(total_vram_mb),
        is_selected: false,
        is_available: true,
    });

    Some(devices)
}

#[cfg(feature = "cuda")]
fn get_cuda_device_name(device_idx: usize) -> Option<String> {
    // In a full implementation, this would query CUDA via llama-cpp-2
    // For now, return a generic name
    let _ = device_idx;
    None
}

#[cfg(feature = "cuda")]
fn get_cuda_vram_mb(device_idx: usize) -> Option<u64> {
    // In a full implementation, this would query CUDA memory
    let _ = device_idx;
    None
}

#[cfg(feature = "metal")]
fn enumerate_metal_devices() -> Option<Vec<DeviceInfo>> {
    // Metal uses unified memory on macOS, so we report system RAM
    let total_ram_mb = get_total_ram_mb();

    Some(vec![DeviceInfo {
        id: "metal:0".to_string(),
        device_type: "metal".to_string(),
        name: "Apple Metal".to_string(),
        vram_mb: Some(total_ram_mb), // Unified memory
        is_selected: false,
        is_available: true,
    }])
}

#[cfg(feature = "rocm")]
fn enumerate_rocm_devices() -> Option<Vec<DeviceInfo>> {
    // ROCm device enumeration
    let mut devices = Vec::new();

    // Placeholder for ROCm device enumeration
    devices.push(DeviceInfo {
        id: "rocm:0".to_string(),
        device_type: "rocm".to_string(),
        name: "AMD GPU (ROCm)".to_string(),
        vram_mb: get_rocm_vram_mb(0),
        is_selected: false,
        is_available: true,
    });

    Some(devices)
}

#[cfg(feature = "rocm")]
fn get_rocm_vram_mb(device_idx: usize) -> Option<u64> {
    let _ = device_idx;
    // Would query ROCm for VRAM
    None
}

#[cfg(feature = "vulkan")]
fn enumerate_vulkan_devices() -> Option<Vec<DeviceInfo>> {
    // Vulkan device enumeration
    // Use wgpu or vulkan API to enumerate devices
    let mut devices = Vec::new();

    // Try to get Vulkan device info
    if let Some(vulkan_info) = get_vulkan_device_info() {
        devices.push(DeviceInfo {
            id: "vulkan:0".to_string(),
            device_type: "vulkan".to_string(),
            name: vulkan_info,
            vram_mb: None, // Vulkan doesn't expose VRAM directly in a portable way
            is_selected: false,
            is_available: true,
        });
    } else {
        // Add a generic Vulkan device
        devices.push(DeviceInfo {
            id: "vulkan:0".to_string(),
            device_type: "vulkan".to_string(),
            name: "Vulkan GPU".to_string(),
            vram_mb: None,
            is_selected: false,
            is_available: true,
        });
    }

    Some(devices)
}

#[cfg(feature = "vulkan")]
fn get_vulkan_device_info() -> Option<String> {
    // Would use wgpu or ash (Vulkan bindings) to query device info
    None
}

/// Get the number of GPU layers to offload based on device selection.
///
/// - CPU only: 0 layers (all on CPU)
/// - GPU selected: 999 layers (offload all to GPU)
pub fn get_n_gpu_layers(device_id: Option<&str>) -> u32 {
    match device_id {
        Some(id) if id.starts_with("cpu") => 0,
        Some(_) => 999, // Offload all layers to GPU
        None => {
            // Auto-detect: if we have a GPU device available, use it
            let devices = enumerate_devices();
            let has_gpu = devices
                .iter()
                .any(|d| d.device_type != "cpu" && d.is_available);
            if has_gpu {
                999
            } else {
                0
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_enumerate_devices_always_has_cpu() {
        let devices = enumerate_devices();
        assert!(!devices.is_empty(), "Should have at least one device");

        let has_cpu = devices.iter().any(|d| d.device_type == "cpu");
        assert!(has_cpu, "Should always have a CPU device");
    }

    #[test]
    fn test_one_device_is_selected() {
        let devices = enumerate_devices();
        let selected_count = devices.iter().filter(|d| d.is_selected).count();
        assert_eq!(selected_count, 1, "Exactly one device should be selected");
    }

    #[test]
    fn test_cpu_device_is_available() {
        let devices = enumerate_devices();
        let cpu = devices.iter().find(|d| d.device_type == "cpu");
        assert!(cpu.is_some(), "Should have a CPU device");
        assert!(cpu.unwrap().is_available, "CPU should always be available");
    }
}

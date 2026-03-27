#!/usr/bin/env python3
"""
Script to download and prepare whisper.cpp server binaries and model files.
Run from the project root: python scripts/prepare_whisper_runtime.py
"""

import os
import sys
import shutil
import urllib.request
import zipfile
import tarfile
import json
import platform

# Configuration
WHISPER_REPO = "ggerganov/whisper.cpp"
MODEL_FILE = "ggml-base.en.bin"
MODEL_URL = f"https://huggingface.co/datasets/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin"
BINARIES = {
    "linux-x86_64": "whisper-server-linux-x86_64",
    "macos-aarch64": "whisper-server-macos-aarch64",
    "macos-x86_64": "whisper-server-macos-x86_64",
    "windows-x86_64": "whisper-server-windows-x86_64.exe",
}

def get_platform_key():
    """Get the platform key for binary selection"""
    system = platform.system().lower()
    arch = platform.machine().lower()
    
    if system == "linux" and arch == "x86_64":
        return "linux-x86_64"
    elif system == "darwin":
        if arch == "aarch64" or arch == "arm64":
            return "macos-aarch64"
        elif arch == "x86_64":
            return "macos-x86_64"
    elif system == "windows" and arch == "AMD64":
        return "windows-x86_64"
    
    return None

def get_resources_dir():
    """Get the resources directory path"""
    # Assuming script is run from project root
    return os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "src-tauri", "resources")

def download_file(url, dest_path):
    """Download a file with progress"""
    print(f"Downloading {url}...")
    print(f"  -> {dest_path}")
    
    # Create directory if needed
    os.makedirs(os.path.dirname(dest_path), exist_ok=True)
    
    # Download with progress
    try:
        urllib.request.urlretrieve(url, dest_path)
        print(f"  Download complete!")
        return True
    except Exception as e:
        print(f"  Error: {e}")
        return False

def download_whisper_cpp():
    """Download and build whisper.cpp"""
    resources_dir = get_resources_dir()
    whisper_dir = os.path.join(resources_dir, "whisper-server")
    
    os.makedirs(whisper_dir, exist_ok=True)
    
    # Check current platform
    platform_key = get_platform_key()
    if not platform_key:
        print(f"Unsupported platform: {platform.system()} {platform.machine()}")
        return False
    
    binary_name = BINARIES[platform_key]
    binary_path = os.path.join(whisper_dir, binary_name)
    
    # Check if already exists
    if os.path.exists(binary_path):
        print(f"Binary already exists: {binary_path}")
        return True
    
    print(f"\n=== Preparing whisper.cpp for {platform_key} ===")
    
    # Try to download pre-built binary from GitHub releases
    # Note: We need to check if there's a release with the server binary
    # For now, we'll try to use the main whisper.cpp binary
    
    # Download the main whisper.cpp binary
    tag = "v1.7.1"  # Use a stable version
    base_url = f"https://github.com/{WHISPER_REPO}/releases/download/{tag}"
    
    # Try to download pre-built binary
    # Note: whisper.cpp releases have different binary names
    # We'll try the most common ones
    
    # For now, create a placeholder - in production, you'd build from source
    print("\nNote: Pre-built whisper-server binaries may not be directly available.")
    print("You may need to build from source or use alternative binaries.")
    print("\nTo build from source:")
    print("  1. Clone whisper.cpp: git clone https://github.com/ggerganov/whisper.cpp")
    print("  2. Build the server: cd whisper.cpp && make server")
    print(f"  3. Copy the binary to: {whisper_dir}")
    
    # Create a placeholder file for now (will be replaced with actual binary)
    placeholder_path = os.path.join(whisper_dir, f"PLACEHOLDER_{binary_name}")
    with open(placeholder_path, "w") as f:
        f.write(f"# Placeholder for {binary_name}\n")
        f.write("# Replace with actual whisper-server binary\n")
    
    return True

def download_model():
    """Download the whisper model file"""
    resources_dir = get_resources_dir()
    models_dir = os.path.join(resources_dir, "models")
    
    os.makedirs(models_dir, exist_ok=True)
    
    model_path = os.path.join(models_dir, "ggml-base.en-q8_0.bin")
    
    # Check if already exists
    if os.path.exists(model_path):
        print(f"Model already exists: {model_path}")
        return True
    
    print(f"\n=== Downloading Whisper Model ===")
    print(f"Model: ggml-base.en-q8_0.bin")
    print(f"Note: Using quantized model for better performance")
    
    # Try to download from HuggingFace (quantized version)
    # The q8_0 version is quantized to 8-bit
    url = "https://huggingface.co/datasets/ggerganov/whisper.cpp/resolve/main/ggml-base.en-q8_0.bin"
    
    return download_file(url, model_path)

def main():
    print("=== Whisper Runtime Preparation ===\n")
    
    # Create resources directory structure
    resources_dir = get_resources_dir()
    print(f"Resources directory: {resources_dir}\n")
    
    # Download model
    if not download_model():
        print("Failed to download model")
        return 1
    
    # Download/prepare whisper.cpp
    if not download_whisper_cpp():
        print("Failed to prepare whisper.cpp")
        return 1
    
    print("\n=== Preparation Complete ===")
    print("\nDirectory structure:")
    print(f"  {resources_dir}/")
    print(f"  ├── models/")
    print(f"  │   └── ggml-base.en-q8_0.bin")
    print(f"  └── whisper-server/")
    print(f"      └── (whisper-server binary for your platform)")
    
    print("\nNext steps:")
    print("  1. Replace placeholder with actual whisper-server binary")
    print("  2. Ensure the binary is executable (chmod +x on Unix)")
    print("  3. Run the application")
    
    return 0

if __name__ == "__main__":
    sys.exit(main())
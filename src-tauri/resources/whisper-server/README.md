# Whisper Server Binary

This directory is where the whisper.cpp server binary should be placed.

## Required Files

For your platform, place the appropriate binary here:

- **Linux (x86_64)**: `whisper-server-linux-x86_64`
- **macOS (Apple Silicon)**: `whisper-server-macos-aarch64`
- **macOS (Intel)**: `whisper-server-macos-x86_64`
- **Windows (x86_64)**: `whisper-server-windows-x86_64.exe`

## Building from Source

The whisper.cpp project doesn't provide pre-built server binaries. To build:

```bash
# Clone whisper.cpp
git clone https://github.com/ggerganov/whisper.cpp

# Build the server
cd whisper.cpp
make server

# Copy the binary here
cp server ./whisper-server-linux-x86_64
```

## Alternative

If you don't want to build from source, you can use the `main` CLI tool from whisper.cpp in a different mode, or look for community-built binaries.

## Current Status

The STT system is ready but requires this binary to function. The model files are already present in the `../whisper/` directory.
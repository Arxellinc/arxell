# Bundled llama.cpp runtimes

This directory is populated during CI builds with platform-specific `llama-server` binaries:

- `resources/llama-runtime/<engine-id>/llama-server` (or `.exe` on Windows)

The GitHub Actions workflow downloads and stages these files before build.

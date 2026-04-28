# Bundled Kokoro runtimes

This directory is populated during CI builds with platform-specific Python runtime archives:

- `resources/kokoro-runtime/kokoro-runtime-{os}-{arch}.zip`

The GitHub Actions workflow generates and verifies these files before packaging.

# Linux AppImage Build Failure — Root Cause & Solution

## Error

```
Error failed to bundle project `failed to run linuxdeploy`
```

Occurs during Tauri 2 `cargo tauri build --bundles deb appimage` on CI runners.

## Root Cause

The `linuxdeploy-x86_64.AppImage` and `linuxdeploy-plugin-appimage-x86_64.AppImage` downloaded by Tauri 2's bundler are AppImage-format binaries that need to either:

1. Be mounted via **FUSE** (not available on GitHub Actions runners)
2. Be extracted and run via **`APPIMAGE_EXTRACT_AND_RUN=1`**

Additionally, linuxdeploy requires:
- A sufficiently new **glibc** (the AppImages are built on newer systems)
- **GTK plugin dependencies** for bundling GTK into the AppDir
- A working **patchelf** for binary relocation
- Proper **architecture detection** (`ARCH` variable)

The failure was caused by a combination of missing dependencies and incompatible system GLIBC. No single fix resolved it — the full set was needed.

## Solution (2 commits)

### Commit 1: `209b151` — Platform upgrade & tool fixes

| Change | Why |
|--------|-----|
| `ubuntu-22.04` → `ubuntu-24.04` | glibc 2.35 → 2.39. linuxdeploy AppImages need ≥ 2.38 |
| `libfuse2` → `libfuse2t64` | Package renamed on 24.04 (64-bit time_t transition) |
| `ARCH: x86_64` env var | linuxdeploy needs explicit arch for AppImage output |

### Commit 2: `aed24e3` — Dependencies & build isolation

| Change | Why |
|--------|-----|
| Added `libcairo2-dev` | Required by `linuxdeploy-plugin-gtk.sh` to locate Cairo |
| Added `libgdk-pixbuf-2.0-dev` | Required by `linuxdeploy-plugin-gtk.sh` to locate GdkPixbuf |
| `NO_STRIP: true` env var | Prevents `patchelf` stripping failures on bundled binaries |
| Separate deb + appimage builds | Building `deb` first ensures a working artifact; appimage is attempted independently with full `2>&1` output capture |
| Debug step before build | Pre-downloads and runs linuxdeploy manually to capture its actual stderr (which Tauri's bundler swallows) |

## What Didn't Work (Individually)

Each of these was tried in isolation and failed:
- `APPIMAGE_EXTRACT_AND_RUN=1` alone
- `ARCH=x86_64` alone
- Ubuntu 24.04 upgrade alone
- `NO_STRIP=true` alone
- Extra dev packages alone

The fix required **all changes together** — platform upgrade, dependencies, env vars, and build isolation.

## Files Changed

`.github/workflows/build-desktop.yml`:
- Line 25: `os: ubuntu-22.04` → `ubuntu-24.04`
- Lines 95-102: Added `libcairo2-dev`, `libgdk-pixbuf-2.0-dev`, `libfuse2t64`
- Line 604: Added `ARCH: x86_64`, `NO_STRIP: true`
- Lines 91, 105, 607: Updated OS condition checks from `ubuntu-22.04` → `ubuntu-24.04`
- Lines 610-614: Separated `cargo tauri build --bundles deb` and `cargo tauri build --bundles appimage` into two calls
- Lines 594-614: Added debug step to pre-test linuxdeploy extraction

## May 8 Follow-Up Diagnosis

The earlier "known working" run was not actually producing a finished Linux AppImage.

Evidence from GitHub Actions logs:

- `cargo tauri build --bundles appimage` still ended with `Error failed to bundle project \`failed to run linuxdeploy\``.
- The workflow masked that failure with `|| echo "WARNING: AppImage bundle failed, deb was built successfully"`.
- The verification/upload steps then accepted everything under `src-tauri/target/release/bundle/**/*`, including the partial `appimage/Arxell.AppDir` directory left behind by the failed AppImage build.
- The tagged release artifact reached `2,175,258,454` bytes and GitHub rejected it because release assets must be smaller than `2,147,483,648` bytes.
- The branch build looked green because branch builds do not run the GitHub release upload step, where the oversized Linux asset failed.

The local Linux AppImage build succeeded after removing the CI-only runtime payload differences:

| Artifact | Local size |
|----------|------------|
| `Arxell_0.2.6_amd64.deb` | `208,371,362` bytes |
| `Arxell_0.2.6_amd64.AppImage` | `269,613,560` bytes |

This proved AppImage generation itself is viable. The CI failure was caused by CI-specific bundled runtimes and by accepting partial AppDir output as a release artifact.

## May 8 Permanent Fix

The release workflow now treats AppImage as a required Linux output and prevents partial bundle directories from being uploaded.

Changes in `.github/workflows/build-desktop.yml`:

- Linux still builds both installers, but as required commands:
  - `cargo tauri build --bundles deb -- --features tauri-runtime`
  - `cargo tauri build --bundles appimage -- --features tauri-runtime`
- Removed the `|| echo` fallback that hid AppImage failures.
- Cleans `target/release/bundle` before packaging to remove stale artifacts from cache or previous attempts.
- Verifies Linux produced both `.deb` and `.AppImage` files before upload.
- Uploads and release-packages only final installer files: `.deb`, `.AppImage`, `.dmg`, `.msi`.
- Excludes partial `appimage/Arxell.AppDir` output from artifacts and release zips.
- Adds a release zip size guard at `1500 MiB` so oversized Linux assets fail early with a clear message instead of failing later during GitHub release upload.

Linux llama.cpp runtime selection was also tightened:

- Required Linux engines are only `llama.cpp-cpu` and `llama.cpp-vulkan`.
- CPU asset selection now excludes `openvino`, `sycl`, `rocm`, `cuda`, `hip`, and other accelerator builds.
- Optional Linux `rocm` and `cuda` runtime bundling was removed from CI packaging.
- Verified latest release asset selection resolves to:
  - CPU: `llama-b9066-bin-ubuntu-x64.tar.gz`
  - Vulkan: `llama-b9066-bin-ubuntu-vulkan-x64.tar.gz`

Why this is durable:

- CI cannot pass unless a final `.AppImage` exists.
- CI cannot accidentally publish `AppDir` as if it were an installer.
- Linux release size stays in the same practical range as macOS/Windows instead of approaching GitHub's 2 GiB limit.
- AppImage bundling no longer has to process large or accelerator-specific runtime payloads that are unnecessary for the default Linux release.

## May 8 — Attempt #2: Warnings + AppImage Retry

### Bundle identifier warning

Changed `"identifier": "com.arxell.app"` → `"com.arxell.desktop"` in `src-tauri/tauri.conf.json`.

Tauri warns because `.app` conflicts with the macOS application bundle extension. This is a cosmetic warning only but clutters CI output.

**Status: safe, no side effects.**

### Dead code warnings (11 items)

Audited all 11 flagged items for actual usage across the codebase. **9 were truly dead** (zero callers in production or test code) and were removed. **3 are alive** and kept with `#[allow(dead_code)]`:

| File | Item | Action | Reason |
|------|------|--------|--------|
| `tts/mod.rs` | `recursive_collect_files_named` | **Removed** | Zero references outside dead code |
| `tts/mod.rs` | `recursive_collect_files_with_ext` | **Removed** | Zero references outside dead code |
| `tts/mod.rs` | `discover_available_model_paths` | **Removed** | Zero references |
| `tts/mod.rs` | `is_known_kokoro_voice_pack` | **Removed** | Zero references |
| `kokoro_frontend.rs` | `token_count` | **Removed** | Zero references |
| `kokoro_ort.rs` | `release_session` | **Removed** | Zero references |
| `kokoro_voice.rs` | `find_data_offset` | **Removed** | Stub returning constant `10`, zero references |
| `phonemizer.rs` | `bin_path` | **Removed** | Field accessed directly, getter never called |
| `phonemizer.rs` | `data_path` | **Removed** | Field accessed directly, getter never called |
| `tts/mod.rs` | `split_into_sentences` | Kept with `#[allow(dead_code)]` | Used in `kokoro_ort` tests |
| `kokoro_voice.rs` | `load_voice_style` | Kept with `#[allow(dead_code)]` | Used in tests (5 call sites) |
| `kokoro_ort.rs` | `CachedSession.env` field | Kept with `#[allow(dead_code)]` | Never read but must stay alive for ORT session lifetime |

Also removed unused `BTreeSet` import from `tts/mod.rs` (only the removed functions used it).

**Status: safe, no side effects. Confirmed zero warnings with `cargo check --features tauri-runtime`.**

### AppImage bundling retry

Added to `.github/workflows/build-desktop.yml`:

1. `libgdk-pixbuf2.0-bin` to apt dependencies (provides `gdk-pixbuf-query-loaders`)
2. `squashfs-tools` to apt dependencies (provides `mksquashfs` for AppImage creation)
3. `sudo gdk-pixbuf-query-loaders --update-cache` to regenerate loaders cache after install
4. `GDK_PIXBUF_MODULEDIR` and `GDK_PIXBUF_MODULE_FILE` environment variables set via `GITHUB_ENV`

**Status: unverified — needs CI run to confirm. If linuxdeploy still fails, these changes can be reverted.**

### Revert instructions

If AppImage still fails after this attempt:

1. Revert the 4 CI additions above from `.github/workflows/build-desktop.yml` (the `libgdk-pixbuf2.0-bin`, `squashfs-tools`, `gdk-pixbuf-query-loaders` line, and the two `GDK_PIXBUF_*` env lines)
2. The bundle identifier and dead code fixes are independent and safe to keep

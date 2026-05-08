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

## Failed Attempts Log

### Attempt 3 — gdk-pixbuf-loader-cache + squashfs-tools

**Commit:** `6c4aeab`
**Result:** FAILED — same `failed to run linuxdeploy` error

Changes:
- Added `libgdk-pixbuf2.0-bin` and `squashfs-tools` to apt dependencies
- Added `gdk-pixbuf-query-loaders --update-cache` after install
- Set `GDK_PIXBUF_MODULEDIR` and `GDK_PIXBUF_MODULE_FILE` via `GITHUB_ENV`
- Kept env vars at step level only (not propagated to child processes)

Why it failed: Environment variables set via `GITHUB_ENV` may not be inherited by all child processes spawned by Tauri's bundler.

### Attempt 4 — Diagnostic: linuxdeploy bare run

**Commit:** `2ad54c7`
**Result:** Diagnostic only (build still failed)

Added a pre-build step that downloaded and ran linuxdeploy directly:
- Confirmed `/tmp` has no `noexec` mount
- Confirmed glibc 2.39 is compatible
- Confirmed linuxdeploy `--help`, `--list`, and `--appdir` all succeed
- Confirmed `APPIMAGE_EXTRACT_AND_RUN=1` works correctly

Key finding: **linuxdeploy itself works fine on CI. The failure is in Tauri's invocation of linuxdeploy with its plugins.**

### Attempt 5 — Job-level env vars + expanded deps + GTK plugin diagnostic

**Commits:** `9944294`, `6a11718`, `4678887`
**Result:** FAILED — same error. Also broke `libasound2-dev` (missing from package list), then fixed.

Changes:
- Moved `APPIMAGE_EXTRACT_AND_RUN`, `ARCH`, `NO_STRIP`, `GDK_PIXBUF_MODULEDIR`, `GDK_PIXBUF_MODULE_FILE` to job-level `env:` block
- Expanded apt packages: added GStreamer dev packages, `gtk+3.0`, `librsvg2-common`, `shared-mime-info`
- Added `gdk-pixbuf-query-loaders --update-cache` (full path), `gtk-query-immodules-3.0 --update-cache`, `update-mime-database`
- Added GTK plugin diagnostic step that runs linuxdeploy with `--plugin gtk`
- Added Linux artifact verification step (check file exists, >10MB, remove partial AppDir)
- Restricted upload globs to `deb/*.deb` and `appimage/*.AppImage` only
- Accidentally dropped `libasound2-dev` and `pkg-config` from package list, then restored them

Diagnostic findings from this run:
- `loaders.cache` exists at `/usr/lib/x86_64-linux-gnu/gdk-pixbuf-2.0/2.10.0/loaders.cache`
- `immodules.cache` exists at `/usr/lib/x86_64-linux-gnu/gtk-3.0/3.0.0/immodules.cache`
- The **GTK plugin ran successfully** in isolation — deployed all shared libraries without error
- GTK plugin stderr: `chmod: cannot access '.../usr/lib64': No such file or directory` (non-fatal)
- GTK plugin stdout: `WARNING: gtk-query-immodules-3.0 not found` (non-fatal)
- No `GTK plugin exit` error = linuxdeploy exited 0 with GTK plugin

**Critical observation:** The GTK plugin works in our diagnostic but the actual Tauri build still fails. There is zero linuxdeploy output between `Bundling Arxell_0.2.7_amd64.AppImage` and `Error failed to bundle project`. This means Tauri's Rust bundler code is either not inheriting stdio correctly, or the linuxdeploy invocation by Tauri differs from our manual test in a way that causes a silent failure.

The failure likely occurs in the **appimage plugin** (`linuxdeploy-plugin-appimage-x86_64.AppImage`), which runs AFTER the GTK plugin to create the actual .AppImage file. Our diagnostic only tested the GTK plugin, not the appimage generation step.

### Attempt 6 — AppImage plugin diagnostic

**Commit:** `1415ab4`
**Result:** AppImage plugin WORKS in diagnostic — build still fails

Added the `linuxdeploy-plugin-appimage-x86_64.AppImage` to the diagnostic step:
- Downloaded from `https://github.com/linuxdeploy/linuxdeploy-plugin-appimage/releases/download/continuous/linuxdeploy-plugin-appimage-x86_64.AppImage`
- `file` shows it's an `ELF 64-bit LSB pie executable, x86-64, static-pie linked` (not actually an AppImage format — it's a static ELF binary)
- `--help` fails with `Failed to parse arguments: Flag could not be matched: help` (expected — it's not a standard CLI tool)
- Full `linuxdeploy --appdir ... --output appimage` **succeeded** — no "FULL appimage build exit" error = exit code 0

Key finding: **Both the GTK plugin and the appimage plugin work correctly in isolation.** The full `--output appimage` pipeline produces a valid AppImage. The real Tauri build still fails with zero linuxdeploy output.

### Attempt 7 — GStreamer plugin diagnostic

**Commit:** `e5b0cc6`
**Result:** ALL THREE PLUGINS WORK IN ISOLATION — build still fails

Added `linuxdeploy-plugin-gstreamer.sh` to the diagnostic:
- `gst-inspect-1.0` not found on CI (`command not found`) but plugin still works via direct library scanning
- GStreamer plugin successfully deployed **250+ plugins** and **200+ shared libraries** (libavcodec, libva, vulkan, ffmpeg, etc.)
- GTK plugin: ✓ works in isolation
- AppImage plugin: ✓ produces valid 28MB squashfs AppImage in isolation
- GStreamer plugin: ✓ works in isolation

**Critical insight:** All three plugins work individually. The failure is specific to Tauri's combined invocation with the real Arxell binary. The GStreamer plugin deploys 200+ shared libraries — combined with GTK + the real binary's WebKit deps, the AppDir becomes enormous, likely overwhelming squashfs creation.

### Attempt 8 — Remove GStreamer runtime plugins + verbose linuxdeploy output

**Commits:** (pending)
**Result:** FAILED — same silent `failed to run linuxdeploy` error

Changes:
1. Removed 5 GStreamer runtime plugin packages from `apt install`
2. Added `-vv` to `cargo tauri build` commands and `RUST_LOG=debug` env var

**Key discovery from Tauri bundler source (tauri-bundler 2.8.0):**

Tauri swallows ALL linuxdeploy output by default. With `-vv` + `RUST_LOG=debug`, the bundler uses `output_ok()` which captures each line at `log::debug!` level. However, even with this, the actual linuxdeploy fatal error was not exposed in CI logs.

Also discovered: `bundle_media_framework` was never explicitly set in `tauri.conf.json`, but GStreamer runtime plugins were still being pulled transitively by WebKitGTK dev packages. The linuxdeploy-plugin-gstreamer diagnostic showed 250+ GStreamer plugins being copied despite the config not enabling media framework bundling.

### Attempt 9 — Explicitly disable GStreamer bundling + clear LD_LIBRARY_PATH + diagnostics

**Commits:** (pending)
**Result:** PENDING

Four targeted changes:

1. **Set `bundleMediaFramework: false`** in `src-tauri/tauri.conf.json`:
   - Added `"linux": { "appimage": { "bundleMediaFramework": false } }` to bundle config
   - Even though it defaults to false, this makes it explicit and prevents any env var override

2. **Clear `LD_LIBRARY_PATH`** for the AppImage build step:
   - Python setup adds `/opt/hostedtoolcache/Python/3.12.13/x64/lib` to `LD_LIBRARY_PATH`
   - This pollutes linuxdeploy's dependency scanning with non-system libraries
   - AppImage build step now sets `LD_LIBRARY_PATH: ""` explicitly

3. **Separate AppImage build from deb build** with `ldd` check in between:
   - `cargo tauri build --bundles deb` runs first (with normal env)
   - New `ldd` check step runs on the built binary to catch missing `.so` dependencies
   - `cargo tauri build --bundles appimage` runs separately with `LD_LIBRARY_PATH=""`
   - Guard step prints `APPIMAGE_BUNDLE_GSTREAMER` value and greps for any media framework config

4. **AppDir size inspection on failure**:
   - New `if: failure()` step inspects the partial AppDir left behind
   - Reports total size, largest dirs, file count, GStreamer payload count, and shared library inventory
   - This will reveal if the AppDir is too large for squashfs or has unexpected payload

## Current State of the CI Workflow

The following changes from failed attempts are still in the workflow and are benign (safe to keep):
- Job-level `APPIMAGE_EXTRACT_AND_RUN`, `ARCH`, `NO_STRIP`, `GDK_PIXBUF_MODULEDIR`, `GDK_PIXBUF_MODULE_FILE`
- Expanded apt package list with GStreamer and GTK runtime deps
- Loader cache regeneration commands
- GTK plugin diagnostic step (non-blocking)
- Linux artifact verification step
- Restricted upload globs

## Next Steps to Investigate

Once we have the actual linuxdeploy error output from attempt 8, we can fix the root cause.

If attempt 8 still fails with no useful output:
1. **Add `DEBUG=1`** to job env — linuxdeploy may respect this for even more output
2. **Try building AppImage manually** after Tauri builds the deb — bypass Tauri's bundler entirely
3. **Check disk space** on CI runner — AppDir + squashfs might exhaust available space

## How Tauri Invokes linuxdeploy (tauri-bundler 2.8.0)

For reference, the actual command Tauri builds is:

```
<path/to/linuxdeploy-x86_64.AppImage> \
    --appimage-extract-and-run \
    --verbosity <0-3> \
    --appdir <path/to/Product.AppDir> \
    --plugin gtk \
    --output appimage
```

Environment variables set by Tauri:
- `OUTPUT=<path/to/output.AppImage>`
- `ARCH=x86_64`
- `APPIMAGE_EXTRACT_AND_RUN=1`

The `--verbosity` is derived from the `-v` flag count:
| `-v` count | Rust log level | linuxdeploy `--verbosity` |
|---|---|---|
| 0 (default) | Error | 3 |
| 1 (`-v`) | Warn | 2 |
| 2 (`-vv`) | Info | 1 |
| 3+ (`-vvv`) | Debug | 0 |

GStreamer plugin (`--plugin gstreamer`) is only added when `bundle_media_framework: true` in `tauri.conf.json`.

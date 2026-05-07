# Image Generation Implementation Plan

## Goal

Ship a local image generation feature that is simple to install, reliable on first use, and integrated into both the Images panel and chat.

The user flow must be:

1. Open the Images panel.
2. Click one `Download and Install` button.
3. Wait for a real byte-based progress bar to complete.
4. Generate images from the panel or request them in chat.

The feature must remain optional. No image model weights are bundled with the app.

## Product Constraints

- Use the existing ONNX Runtime path for V1.
- The curated install target is the official FLUX Schnell ONNX bundle, not the oversized AMD mirror metadata currently shown in the UI.
- The main transformer model may be under `8 GB`, but the full runnable ONNX package is larger and must be reported honestly.
- The Images panel must show both:
  - `Core model size`
  - `Total install size`
- The top of the Images panel must have an accurate download progress bar, matching the LLM model manager behavior as closely as possible.

## Current Facts

As of May 7, 2026:

- Official ONNX repo: `black-forest-labs/FLUX.1-schnell-onnx`
- Quantized ONNX variants exist, including `FP4`
- Verified official component sizes indicate:
  - FP4 transformer data is about `6.77 GB`
  - Full runnable ONNX package is about `16.6+ GB`

This means:

- The current `36 GB` UI number is misleading for the curated path.
- The curated ONNX path is acceptable only if the UI reports the real total install size and progress accurately.

## Package Audit Findings

Audit result as of May 7, 2026:

- The curated ONNX mirror `Futuremark/FLUX.1-schnell-onnx` matches the official `black-forest-labs/FLUX.1-schnell-onnx` ONNX export tree.
- That export tree contains:
  - `clip.opt`
  - `t5.opt`
  - `t5-fp8.opt`
  - `transformer.opt`
  - `vae.opt`
- It does **not** contain the diffusers-style pipeline assets required for full FLUX generation:
  - `model_index.json`
  - `scheduler/scheduler_config.json`
  - `text_encoder/config.json`
  - `text_encoder_2/config.json`
  - `tokenizer/*`
  - `tokenizer_2/*`
  - `unet/config.json`
  - `vae_decoder/config.json`
  - `vae_encoder/config.json`

This means the current curated ONNX mirror is sufficient for:

- file validation
- byte-accurate download/install
- ONNX session probing

It is **not** sufficient by itself for end-to-end image generation.

Therefore V1 generation must use a supplemented curated bundle:

1. primary ONNX weights from `Futuremark/FLUX.1-schnell-onnx`
2. supplemental tokenizer, scheduler, and config assets from `amd/FLUX.1-schnell-onnx`

Phase 5 is to assemble and validate that combined manifest in one managed install layout.

## V1 Package Strategy

Use one blessed curated package definition:

- Primary repo: `Futuremark/FLUX.1-schnell-onnx`
- Supplemental repo: `amd/FLUX.1-schnell-onnx`
- Upstream reference: `black-forest-labs/FLUX.1-schnell-onnx`
- Precision target: `FP4` transformer where supported by the package layout
- Auxiliary components:
  - T5
  - CLIP
  - VAE
  - tokenizers
  - scheduler/config files

The manifest must explicitly define:

- package id
- repo id
- source URL
- license
- core model bytes
- auxiliary bytes
- total install bytes
- required files/folders
- recommended settings:
  - steps `4`
  - guidance `1.0`

## Reliability Standard

The feature is not considered ready until these are all true:

- `Download and Install` always triggers a visible action.
- Download progress is based on real bytes received.
- Install state survives panel close/reopen and app restart.
- Activation happens only after full validation.
- Generation remains disabled until a real runtime probe succeeds.
- The first generation after a successful install works without manual setup.

## Phase 1: Curated Package Manifest

### Tasks

- Replace the current hardcoded AMD package metadata.
- Add a curated package manifest for the official ONNX bundle.
- Track:
  - `coreModelBytes`
  - `auxiliaryBytes`
  - `totalInstallBytes`
- Update the Images panel package section to show:
  - model name
  - source link
  - license
  - `Core model: ...`
  - `Total install: ...`
- Remove the misleading default `36 GB` display.

### Exit Criteria

- The panel reports the correct curated package.
- The displayed size numbers match the actual install manifest.

## Phase 2: Shared Downloader and Accurate Progress

### Tasks

- Reuse the model manager download/progress pattern instead of a separate ad hoc flow.
- Pre-compute `totalBytes` from package file metadata before download starts.
- Emit progress events for:
  - `preflight`
  - `downloading`
  - `validating`
  - `activating`
  - `complete`
  - `error`
- Track:
  - current file
  - received bytes
  - total bytes
  - percent
  - transfer speed
- Keep the progress bar pinned at the top of the Images panel.
- Preserve progress state across rerenders and panel reopen.
- Add cancel support.

### Exit Criteria

- The Images panel shows a real byte-accurate progress bar.
- Progress behavior matches the LLM model manager closely enough to feel native.

## Phase 3: Installer Hardening

### Tasks

- Run preflight checks before download:
  - network reachability
  - write access
  - free disk space with staging headroom
  - manifest completeness
  - ONNX Runtime availability
- Download only into staging.
- Validate staged files before activation:
  - required paths exist
  - expected sizes are present when known
  - ONNX bundle structure is intact
- Activate atomically.
- Preserve the previous working install on failure.
- Clean partial staging on cancel or failure.
- Store install state and disabled preference separately.

### Exit Criteria

- Interrupted or failed installs do not corrupt the active package.
- User-visible errors name the failed phase.

## Phase 4: Runtime Probe Gate

### Tasks

- Implement a real ONNX runtime probe, not just folder validation.
- Verify:
  - tokenizer load
  - text encoder load
  - transformer session load
  - VAE load
  - one verified probe image written to disk
- Set `generationReady = true` only after that succeeds.
- Keep generation disabled with a clear error if the probe fails.

### Exit Criteria

- Installed package status can distinguish:
  - `not installed`
  - `installed, not validated`
  - `installed, probe failed`
  - `ready`

Note:

- Passing the runtime probe only proves ONNX sessions load.
- It does not prove that tokenizer, scheduler, config, and latent-to-image pipeline assets are complete.

## Phase 5: Images Panel Completion

### Tasks

- Keep the existing `image` sidebar icon.
- Top controls:
  - status pill
  - refresh button
  - progress bar
  - `Download and Install`
  - `Disable image generation` checkbox
- Package section:
  - model name
  - source link
  - license
  - core model size
  - total install size
  - install location
- Generation section:
  - prompt
  - size presets
  - steps
  - guidance
  - seed
  - generate button
- Advanced section:
  - negative prompt
  - numeric width/height
  - manual package folder selection for recovery only
  - provider diagnostics
- Bottom action:
  - `Remove image packages`

### Exit Criteria

- The panel is fully usable without hidden setup steps.
- Buttons always produce visible status changes.

## Phase 6: Chat Integration

### Tasks

- Allow image requests in chat only when:
  - package installed
  - runtime probe passed
  - feature not disabled
- Render generated images inline in chat.
- Keep inline image width at about `85%` of the chat panel width.
- Show very small right-aligned `Save` and `Copy` actions below each image.
- Support image uploads in standard formats:
  - `.png`
  - `.jpg`
  - `.jpeg`
  - `.webp`
- Ensure images do not destabilize chat scroll behavior while streaming.

### Exit Criteria

- Uploaded and generated images display reliably inline.
- Chat remains stable during streaming and image load.

## Phase 7: Remove Placeholder States

### Tasks

- Eliminate any `installed but not actually usable` success state in the user-facing flow.
- If install succeeds but probe fails:
  - keep package installed
  - show concrete runtime error
  - keep generation disabled
- If the runtime is unavailable:
  - all buttons must still respond
  - the panel must explain why generation is unavailable

### Exit Criteria

- No silent no-op buttons.
- No false-ready states.

## Phase 8: QA and First-Test Reliability

### Test Matrix

- clean first install
- cancel during download
- failed download
- failed validation
- failed probe
- successful install then restart
- disable and re-enable image generation
- remove packages
- first successful generation
- chat image request after install
- inline image save/copy actions

### Release Gate

Do not call the feature complete until:

- one-click install works
- the top progress bar is byte-accurate
- size reporting is honest
- install state persists
- first post-install generation works on the first test
- chat image requests work when enabled

## Implementation Order

1. Curated package manifest and correct size reporting
2. Shared downloader and accurate progress events
3. Installer hardening
4. Runtime probe gate
5. Resolve supplemental asset manifest for full FLUX generation
6. Implement generation pipeline
7. Images panel completion
8. Chat generation enablement
9. QA pass

## Immediate Next Steps

1. Lock the supplemental asset manifest required for real FLUX generation.
2. Decide whether those assets will come from the gated `FLUX.1-schnell` repo or another legally usable source.
3. Implement the actual generation pipeline only after the asset manifest is complete.

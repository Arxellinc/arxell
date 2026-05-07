# Image Generation Panel + Chat Integration Final Plan

## Goal

Add an optional local image generation feature to Arxell with a dedicated left-sidebar panel and chat integration. The app should ship the engine and UI only. Model weights are never bundled; users install the curated model package from the Images panel when they want the feature.

The first-run setup must be simple: the user opens the Images panel, clicks one `Download and Install` button, waits for install/validation, and image generation is enabled automatically when the package is ready.

## Recommended V1 Model Package

Use `amd/FLUX.1-schnell-onnx` as the first curated package target.

Reasons:

- High-quality FLUX.1 Schnell image generation.
- Apache-2.0 model license.
- ONNX/Diffusers-style package layout that maps cleanly to a local runtime.
- Includes the expected components for a full text-to-image pipeline:
  - `scheduler`
  - `text_encoder`
  - `text_encoder_2`
  - `tokenizer`
  - `tokenizer_2`
  - `unet`
  - `vae_decoder`
  - `vae_encoder`
  - `model_index.json`
- Known inference settings from the package card:
  - `InferenceSteps = 4`
  - `GuidanceScale = 1.0`
  - `FlowMatchEulerDiscrete`

The package is large, roughly tens of GB, so the install path must be explicitly optional and user-controlled. The panel must show the expected size before download starts.

## Core Architecture

Use the existing Tauri/Rust backend and the existing ONNX Runtime dependency already present in the project. The first implementation should avoid adding a Python sidecar.

The feature should be split into four main surfaces:

- Images panel: model status, one-click install, enable/disable control, settings, generation queue, package removal, gallery.
- Media service: shared local image import, storage, thumbnailing, safe file resolution, metadata.
- Chat rendering: inline uploaded images and generated image outputs.
- Agent tool: optional `image.generate` tool exposed only when image generation is installed, valid, and enabled.

## First-Run UX Contract

The first test should work without manual file setup.

Required behavior:

- If no image package is installed, the top of the Images panel shows a clear `Download and Install` button.
- Clicking `Download and Install` downloads the curated package, installs it into the app-managed model directory, validates it, and marks the engine ready.
- After a successful install, image generation is enabled by default for both the Images panel and chat.
- The top of the Images panel includes a `Disable image generation` checkbox.
- When the checkbox is checked, the Images panel remains visible but generation controls and the chat `image.generate` tool are disabled.
- When the checkbox is unchecked and a valid package is installed, generation is available again without reinstalling.
- The bottom of the Images panel includes a `Remove image packages` button.
- `Remove image packages` asks for confirmation, stops any active generation, deletes installed image model packages from the app-managed model directory, clears the ready state, and disables chat image generation.
- Manual model folder selection is an advanced recovery/developer option, not the default setup path.

Reliability requirements:

- The installer must run preflight checks before download:
  - network availability
  - available disk space for download plus unpack/install staging
  - write access to the app-managed image package directory
  - supported OS/runtime architecture
  - ONNX Runtime availability
- Downloaded files must go into a staging directory first, never directly into the active package directory.
- The app must validate the complete package before switching the installed state to ready.
- The installed package state and the enabled/disabled user preference must be stored separately.
- Failed, canceled, or partial installs must leave the panel in a clean `Not installed` or previous-working-package state.
- User-facing install errors must include the failed phase: preflight, download, unpack, validate, activate, or runtime check.

## Phase 0: Technical Spike

- Validate `amd/FLUX.1-schnell-onnx` folder structure locally.
- Confirm ONNX Runtime can load the required model files through the existing Rust runtime setup.
- Confirm which execution providers are available in our packaged app.
- Run one minimal generation outside the UI without Python.
- Record the exact pipeline steps:
  - Tokenization.
  - Text encoder inputs and outputs.
  - Latent initialization.
  - Scheduler loop.
  - UNet invocation.
  - VAE decode.
  - PNG encode.
- Decide whether V1 can implement the full pipeline directly in Rust or needs a small dedicated runtime helper.

Exit criteria:

- One image can be generated from a prompt on a developer machine.
- Missing provider/model errors are understandable and recoverable.
- The final runtime choice is documented before UI work depends on it.

## Phase 1: Shared Media Layer

Add a backend media service that is not specific to image generation.

Tasks:

- Create a safe app-managed media directory.
- Define `MediaAssetRecord` with:
  - `id`
  - `kind`
  - `mime`
  - `filename`
  - `path`
  - `width`
  - `height`
  - `sizeBytes`
  - `createdAt`
  - optional generation metadata
- Support import of `.png`, `.jpg`, `.jpeg`, and `.webp`.
- Generate thumbnails for gallery and chat previews.
- Add safe path resolution so the frontend never receives arbitrary filesystem paths.
- Add commands for import, list, delete, and open/reveal.
- Store metadata in the existing app data model or a small local metadata file.

Exit criteria:

- A user can attach an image and see a stable preview record.
- Media paths are confined to approved app/project storage.

## Phase 2: Chat Image Rendering

Extend chat messages to support structured image attachments.

Tasks:

- Add image attachment metadata to user and assistant messages.
- Render uploaded user images inline inside chat.
- Render generated assistant images inline as image cards.
- Size inline chat images to fill about 85% of the chat panel width, with responsive max-width handling on narrow panels.
- Add very small `Save` and `Copy` actions under each inline image, aligned to the right.
- Add missing-file and failed-load states.
- Persist references to media records, not base64 image payloads.
- Keep scroll behavior stable while images load or stream responses continue.
- Ensure thumbnails reserve layout space before images finish loading.

Exit criteria:

- Uploaded images display inline in chat.
- Inline chat images use a stable 85% panel-width layout and expose compact right-aligned save/copy actions.
- Generated image placeholders do not cause message disappearance or scroll jumps.
- Existing text-only chat behavior is unchanged.

## Phase 3: Images Panel Shell

Add a new left-sidebar icon and panel for image generation. Use the existing `image` icon for the Images panel.

Tasks:

- Add the sidebar `image` icon and panel registration.
- Create the panel state, renderer, bindings, and scoped CSS.
- Match existing sidebar and panel styling conventions.
- Add engine status:
  - Not installed.
  - Model missing.
  - Ready.
  - Generating.
  - Error.
- Add settings:
  - Model status: `Not installed`, `Ready`, `Generating`, or `Error`.
  - `Download and Install` button when the package is not installed.
  - Install progress with downloaded size, total size, speed, and current phase.
  - Installed package location.
  - `Disable image generation` checkbox at the top of the panel.
  - Source and license link for the recommended package.
  - Prompt textarea.
  - Size presets: `512x512`, `768x768`, and `1024x1024`.
  - Aspect ratio presets: square, portrait, and landscape.
  - Steps, defaulting to `4` for FLUX Schnell.
  - Guidance scale, defaulting to `1.0` for FLUX Schnell.
  - Seed, random by default with a lock/reuse option.
  - Output count, limited to `1` in V1.
  - Save location: app media library or current project.
  - Gallery sort, defaulting to newest first.
  - Open output folder or reveal image action.
  - Execution provider status.
  - Cancel current generation action.
  - `Remove image packages` button at the bottom of the panel.
- Keep advanced settings behind an expandable section:
  - Negative prompt.
  - Numeric width and height inputs.
  - Filename pattern.
  - Select existing local model folder.
  - Scheduler, only if more than the curated FLUX default is supported.
  - Precision/provider diagnostics.
  - Max stored outputs or cleanup behavior.
  - Prompt metadata toggle.
- Add gallery view for generated and imported images.

Exit criteria:

- The panel is navigable from the left sidebar.
- The default panel flow is simple: click `Download and Install`, enter prompt, choose size, generate.
- After install succeeds, image generation is enabled automatically.
- The top `Disable image generation` checkbox disables generation without removing the installed package.
- The bottom `Remove image packages` button fully removes installed image packages after confirmation.
- Advanced controls are present but hidden until needed.
- The user can configure settings and see engine readiness.
- No model download is required just to open the panel.

## Phase 4: ONNX Image Generation Service

Add the backend image generation runtime behind a stable command API.

Tasks:

- Create an `ImageGenerationService`.
- Add model package validation for the curated FLUX ONNX layout.
- Validate required files and folders:
  - `scheduler`
  - `text_encoder`
  - `text_encoder_2`
  - `tokenizer`
  - `tokenizer_2`
  - `unet`
  - `vae_decoder`
  - `model_index.json`
- Add provider diagnostics before generation starts.
- Lazily load model sessions only when needed.
- Limit V1 to one generation at a time.
- Add cancellation if the runtime path supports it cleanly.
- Save generated PNGs through the shared media service.
- Emit progress events for the panel and chat.

Exit criteria:

- The backend can generate an image and return a `MediaAssetRecord`.
- Failures are surfaced as actionable UI errors.
- The app remains responsive while generation runs.

## Phase 5: One-Click Model Install Flow

Add a user-controlled one-click install flow.

Tasks:

- Make managed install the V1 default setup path.
- Add one primary `Download and Install` button in the Images panel.
- Run installer preflight checks before starting the download.
- Download the curated model package into a temporary app-managed staging directory.
- Verify the staged package before activating it.
- Move the validated package into the app-managed image model directory atomically.
- Run a lightweight runtime readiness check after activation.
- Enable image generation automatically after install succeeds.
- Persist install state and enabled/disabled state separately.
- If install fails or is canceled, leave the previous working package untouched.
- Resume or restart incomplete downloads cleanly.
- Keep partial downloads out of the active model directory.
- Show curated package metadata:
  - Model name.
  - Source link.
  - License.
  - Approximate disk size.
  - Recommended settings.
- Allow the user to open the model source page.
- Allow selecting an already-downloaded local model folder only from advanced settings.
- Show progress and resumability during managed download.
- Verify checksums when the package source provides them.
- Never silently download gated, licensed, or very large assets.
- Add a `Remove image packages` action at the bottom of the Images panel.
- Confirm removal before deleting package files.
- Removal stops active generation, deletes installed image packages, clears package metadata, disables image generation, and returns the panel to the not-installed state.

Exit criteria:

- Users can enable the feature without Arxell bundling model weights and without manually selecting files.
- The happy path is one click: `Download and Install`.
- A valid install enables image generation by default.
- The user can disable generation without uninstalling.
- The user can remove image packages completely from the Images panel.
- Invalid model folders produce clear validation errors.

## Phase 6: Chat Tool Integration

Expose image generation to the agent only when it is ready and not disabled.

Tasks:

- Register an `image.generate` tool only when:
  - A valid model package is installed.
  - The image service is ready.
  - Image generation is not disabled by the top panel checkbox.
- Tool schema:
  - `prompt`
  - `width`
  - `height`
  - `steps`
  - `guidance`
  - `seed`
- Return media metadata, not raw image bytes.
- Render generated images inline in assistant messages.
- Use the same chat image layout for generated images: about 85% of chat panel width, with tiny right-aligned `Save` and `Copy` actions below the image.
- Add an `Open in Images` action for generated images.
- If disabled or unavailable, the agent should explain that local image generation is not enabled.

Exit criteria:

- A user can request an image in chat and receive an inline generated result.
- After package install, chat image generation works by default unless the user checks `Disable image generation`.
- Text-only chat users do not see broken or unavailable tools.

## Phase 7: Image Attachments to Chat Models

Support user image uploads as chat input.

Tasks:

- Add image attachment controls to chat input.
- Accept `.png`, `.jpg`, `.jpeg`, and `.webp`.
- Route image attachments to image-capable chat providers/models.
- Fall back to filename/metadata context for non-vision models.
- Add attachment size limits and friendly validation errors.
- Reuse the shared media service for storage and thumbnails.

Exit criteria:

- Users can attach images to chat messages.
- Vision-capable models receive the image content.
- Non-vision model behavior is graceful and predictable.

## Phase 8: Safety and Reliability

Tasks:

- Confine all generated and imported media to approved directories.
- Validate MIME type and extension.
- Avoid rendering arbitrary local file paths in the frontend.
- Store prompt, seed, dimensions, model id, and generation settings with outputs.
- Display model license/source in the panel.
- Provide a top-of-panel `Disable image generation` checkbox that disables both panel generation and chat generation without deleting installed packages.
- Provide a bottom-of-panel `Remove image packages` button that removes installed packages after confirmation.
- Add recovery states for deleted/moved model folders.

Exit criteria:

- The feature does not widen arbitrary file access.
- Users can understand what model is installed and where outputs are stored.

## Phase 9: QA

Automated tests:

- Model package validation.
- Installer preflight success and failure cases.
- Staged install activation only after validation succeeds.
- Partial download/canceled install cleanup.
- Enabled-by-default state after successful install.
- Separate persistence of installed package state and disabled checkbox state.
- Package removal cleanup and state reset.
- Media import and safe path handling.
- Chat attachment metadata persistence.
- Inline image rendering with missing-file fallback.
- Mocked image generation command.
- Disabled chat tool behavior.
- One-click install state transitions.
- Package removal state transitions.

Manual tests:

- Fresh install with only the `Download and Install` button.
- Confirm image generation is enabled by default after install.
- Check `Disable image generation` and verify panel generation and chat tool are disabled.
- Uncheck `Disable image generation` and verify generation works without reinstalling.
- Use `Remove image packages` and verify package files, ready state, and chat tool are removed.
- Select valid FLUX ONNX folder from advanced settings.
- Select invalid folder from advanced settings and verify errors.
- Generate from Images panel.
- Generate from chat.
- Upload `.png`, `.jpg`, `.jpeg`, and `.webp`.
- Restart app and verify media records persist.
- Delete/move model folder and verify recovery state.

## V1 Deliverable

The first complete milestone should include:

- New Images sidebar panel.
- Existing `image` icon used for the Images sidebar button.
- One-click `Download and Install` setup from the Images panel.
- Image generation enabled by default after successful install.
- Top-of-panel `Disable image generation` checkbox.
- Bottom-of-panel `Remove image packages` button.
- Advanced optional local model folder selection.
- Curated support for `amd/FLUX.1-schnell-onnx`.
- Shared media storage and thumbnails.
- Inline chat image rendering.
- Chat image uploads.
- Optional `image.generate` agent tool when enabled.
- Single-image generation queue.
- Clear not-installed and disabled states.

## Defer Until After V1

- Multiple model families.
- Managed background model downloader.
- GPU provider selection UI beyond diagnostics.
- Batch generation.
- Inpainting and image-to-image.
- Prompt templates or style presets.
- Cloud image generation providers.
- Advanced gallery organization.

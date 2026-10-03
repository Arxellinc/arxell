# Assistant safety, memory, and task outcomes

Implements the four findings in `review(2026-09-29).md`. Calendar and email connectors are not added in this change.

## Direct chat authorization

`tools/action_policy.rs` owns the allowlist and canonical resource checks. `tools/agent_registry.rs` applies them before direct-agent dispatch; automatic `tool_invoke` tasks use the same read policy and the normal enabled-tool invoke gateway.

Direct chat can read explicitly named workspace files, list nonprotected directory entries, read the current in-scope Sheets workbook, display charts, and use an enabled/configured web-search connection. It cannot run shell commands, edit files/Notepad, create/open/edit/save Sheets, or recursively search arbitrary filesystem trees. `open_sheet` is not treated as a read: its old missing-file fallback can create a file.

File reads resolve relative paths against the agent workspace, not the process cwd. Absolute paths must resolve within that same canonical root; filesystem roots and the user's home directory are not valid broad grants. Parent traversal, symlink escapes, and protected components (including `.git`, `.pi`, `.ssh`, `.env`, `.arxell`, plaintext API-secret files, credential/config directories, and private-key suffixes) are denied. Directory listings hide protected/out-of-scope entries. Ungranted Windows UNC/device namespaces are rejected before filesystem lookup to avoid arbitrary SMB credential probes. Sheet reads authorize and read an immutable workbook snapshot, so a concurrent UI workbook switch cannot substitute another resource.

The existing agent workspace resolution is retained: an operator-supplied `ARXELL_AGENT_CWD`, the existing `~/Documents/Arxell` workspace, or the application working directory fallback. This is **not** an OS sandbox or protection against a hostile local process changing filesystem objects concurrently.

Mutations and shell execution require the existing Planner workflow and explicit approval of a project-scoped Pi-backed Looper run. Manual workspace/terminal actions remain user-controlled. Manual file writes also reject parent traversal and use canonical existing ancestors before creating missing paths; they cannot escape through a nonexistent `../` chain. Scheduled `tool_invoke` tasks allow only scoped file reads/listing and Sheets inspection/range reads; a `low` risk label does not grant arbitrary registry access. Approved `agent_prompt`/`looper_run` tasks retain the Pi policy and require Looper enablement. Task and target-tool disablement is honored. Scheduled file reads use an isolated service instance for the approved project root; they do not expand the manual UI's global file scope.

These controls do not make future mailbox access automatically safe. Connector authorization, cloud-context consent, and untrusted-content isolation still need their own design before email is added.

## Diagnostic privacy

Direct-agent tool events contain only `toolCallId`, `toolName`, and optional `success`. Call IDs are stable backend-local IDs for one request, not model-supplied strings; unknown tool names are replaced with `unknown`. Raw displays, commands, arguments, output, and stderr are not copied into diagnostic events. Looper completion/failure events carry only the `ship`/`revise` decision label, not the review artifact contents. The event hub enforces this allowlist even if a caller supplies extra fields; the frontend also ignores legacy tool displays.

Known credential fields are recursively redacted, including nested arrays and common camel/snake/case variants. Redaction is defense in depth, not a guarantee that arbitrary text contains no secret. API registry context uses only connection type/name metadata, never raw keys, key prefixes/masks, or authenticated URLs.

Chat/reasoning deltas, terminal output, Notepad document sync, chart source, and Pi message deltas/final summaries are deliberate presentation events. They are broadcast to their UI consumers but not retained in the event hub's diagnostic history. This does not erase the normal user-visible conversation/terminal state or existing conversation persistence.

## Durable, truthful saved memory

Explicit Memory/custom-item saves use SQLite (`memory.sqlite3`, beside the conversation database). Save/read/delete failures propagate rather than returning success. No chat messages or tool/mail content are automatically copied into saved memory.

Direct-agent request construction and inspection share the same context builder. User-saved directives, custom context, user preferences, facts, personality, and other entries are selected deterministically within a 32 KiB saved-context budget; each entry is limited to 16 KiB. Inspector entries marked `default` are selected; `dynamic` entries marked `context_budget` are not sent. Legacy chat uses the same saved-memory selection. Selected skill bodies share a separate 32 KiB budget (individual sources over 64 KiB are not loaded); explicit always-load skill preferences are honored subject to that budget. Available skill bodies and tool catalogs are not represented as sent merely because they can be inspected. The base-prompt editor shows only the configured prompt, not generated time/skill metadata.

Saved selected entries accompany subsequent chat requests to the selected model, **including configured cloud models**. The Memory UI discloses this. Do not store credentials. Deletion stops new context selection. The repository requests SQLite secure deletion and a WAL checkpoint, not a guaranteed forensic wipe; existing/in-flight runs, old conversations, provider-side retention, external backups, and OS storage copies are not erased. Storage is local plaintext like conversation storage, not a new encrypted vault. Existing process-local memory cannot be recovered after a past restart.

## Delegated run lifecycle

A task launch persists a unique `starting` run and intended loop identity **before** side effects. Successful delegation changes it to `running`, with no completion timestamp. Both agent prompts and explicit Looper tasks use this lifecycle; a launch acknowledgement is not success.

The backend reconciliation service maps completed/failed/stopped Looper runs to terminal task outcomes. It runs on scheduler ticks and run-history/notification/status reads. Outcome, completion time, notification, schedule advancement, and claim release are committed together. Repeated reconciliation is idempotent. Failed scheduler/persistence operations surface as errors rather than silent success.

- A durable active run blocks another manual/scheduled run of the same task even after the launch lease expires. Cancellation does not release this gate until the RPC worker/process-tree cleanup has drained. Stale claim owners and changed task snapshots cannot launch work.
- One-time occurrences are consumed when intent is persisted, preventing replay after a crash.
- Recurring occurrences that become due during active execution are skipped; the next future occurrence is selected on completion.
- Manual runs do not consume or clear an unrelated schedule.
- Active tasks cannot be edited/deleted until the run is stopped and reconciled.
- Startup preserves a persisted terminal loop outcome; unfinished or missing runs become interrupted failures. Ambiguous interrupted work is never automatically replayed.
- Historical `running` records are reconciled on startup. Historical records already labeled `succeeded` by the old launcher are not retroactively certified as real execution success.

The scheduler still requires Arxell to be running. No closed-app calendar/reminder promise is introduced.

## Regression coverage

Tests cover policy-before-execution, scope/traversal/symlink/protected-file denial, nonmutating Sheets reads, immutable snapshot reads, scheduled mutation denial, metadata-only diagnostics, nested credential redaction, presentation-history exclusion, durable memory/deletion, exact saved-context selection, editable context key round trips, API metadata privacy, terminal task outcomes, restart recovery, idempotent notifications, and overlap/recurrence/manual-schedule behavior.

Credentialed provider runs and interactive desktop acceptance remain manual checks; automated tests use local fixtures rather than real mailboxes or credentials.

Verification on Linux: clean frontend install/build/lint and 32 frontend tests; Rust checks with/without `tauri-runtime`, 150 library tests without the feature and 188 with it; desktop `cargo tauri build --no-bundle --features tauri-runtime`. One native-keychain round-trip test is intentionally ignored because it requires an unlocked desktop credential store. Node test typings are now a pinned dev dependency, so clean installs do not depend on optional peer-dependency behavior.

# Local Diagnostics Logging Design

## Goal

Add enough structured local diagnostics to explain intermittent Windows failures when reading a Photoshop selection and to diagnose adjacent file, clipboard, bridge, and canvas IO failures. Keep only events from the most recent 24 hours and let the user export them from Settings.

The release target is `0.3.12` after rebasing onto the remotely published `0.3.11` baseline.

## Architecture

Electron Main owns persistence and export. It writes newline-delimited JSON to an app-owned diagnostics directory under Electron `userData`. Renderer and UXP never write diagnostic files directly.

UXP posts authenticated structured progress events immediately before and after every awaited Photoshop boundary. It also returns the complete trace with the final command response. Electron persists live progress as it arrives and uses event IDs to deduplicate the final trace while filling any gaps. This keeps one persistence clock, one retention policy, and one export path while preserving the last completed stage when Photoshop hangs or UXP cannot finish the command.

The implementation is split into these modules:

- `electron/diagnosticLogger.js`: serialization, redaction, hourly storage, exact 24-hour pruning, export, and corrupt-record tolerance.
- `electron/main.js`: application lifecycle, IPC, local file/clipboard IO, Bridge transport, UXP command timing, and export dialog instrumentation.
- `src/uxp/diagnosticTrace.ts`: typed in-memory trace collector and best-effort authenticated progress reporter for one UXP command.
- `src/uxp/main.ts`: trace creation, runtime metadata, and trace attachment to success and error responses.
- `src/uxp/canvasPrimitives.ts`: selection-specific stage facts at the boundaries where Photoshop imaging data becomes available.
- `src/services/electronBridge.ts`: typed diagnostic export API.
- `src/composables/useLightyearBanana.ts`: diagnostic export state and action.
- `src/components/lightyear/SettingsPanel.vue`: presentational export control driven by props and events.

## Event Schema

Every stored record contains:

- `timestamp`: ISO timestamp.
- `level`: `info`, `warn`, or `error`.
- `sessionId`: Electron process session.
- `requestId`: shared Electron-to-UXP command identifier when applicable.
- `eventId`: stable request-and-sequence identifier used for deduplication.
- `sequence`: monotonically increasing sequence within a request.
- `offsetMs`: monotonic milliseconds since the command trace started.
- `category`: `app`, `settings`, `file`, `clipboard`, `bridge`, `photoshop`, `update`, or `diagnostics`.
- `operation`: stable machine-readable action name.
- `phase`: `start`, `progress`, `success`, `cancel`, `error`, or `timeout`.
- `durationMs`: elapsed time for completed operations.
- `runtime`: App version, build number, Electron, Chrome, Node, platform, OS release, architecture, locale, and process type where available.
- `details`: operation-specific structured facts.
- `error`: error name, message, code, errno, syscall, path, stack, cause, and Photoshop-specific numeric fields when present.

The logger recursively redacts keys matching credentials or authorization data. It also drops image bytes, Base64 payloads, data URLs, prompts, and generated text. Paths and document names remain available because Windows path shape, Unicode, drive type, and document identity can be relevant to IO failures.

## Coverage

Electron records:

- app start, ready, window creation, bridge server start, and shutdown;
- settings file read/write with path, byte count, outcome, and parse failures;
- reference file dialog, selected path, stat, decode, compression attempts, output size, and cancellation;
- clipboard format discovery, image decode, dimensions, and failures;
- generated image fetch/decode, save dialog, destination path, byte count, and write outcome;
- update manifest request, response status, parse, comparison, and failure;
- UXP hello, connection freshness, command queue, dispatch, response, duration, rejection, and timeout;
- renderer IPC command start, completion, cancellation, and failure;
- diagnostics prune and export operations.

No-op long polls are excluded to prevent noise.

UXP records command start and completion for all supported Photoshop commands. Selection capture additionally records:

- Photoshop version and active document metadata;
- document ID, name, dimensions, color mode, bit depth, active layer IDs and names;
- modal entry and exit;
- document metadata read;
- `selection.getSelection.before` and `selection.getSelection.after`;
- `selection.getData.before` and `selection.getData.after`;
- typed-array type, components, actual byte length, expected byte length, and buffer validation;
- mask conversion, source bounds, byte length, non-zero pixel count, and calculated selection bounds;
- `composite.getPixels.before` and `composite.getPixels.after`, including requested and returned bounds;
- `composite.getData.before` and `composite.getData.after`, including dimensions, components, typed-array type, and byte lengths;
- mask crop and RGBA composite dimensions and byte lengths;
- preview image-data creation, encoding, and disposal;
- selection and composite image-data disposal;
- payload serialization;
- response posting start and completion;
- the exact stage and structured error if any call fails.

Photoshop error normalization reads known fields directly even when they are non-enumerable, including `name`, `message`, `number`, `code`, `stack`, `cause`, `descriptor`, and host-specific details.

Live progress uses `POST /uxp/diagnostics?token=...` with this body:

```json
{
  "requestId": "command UUID",
  "event": {
    "eventId": "command UUID:sequence",
    "sequence": 1,
    "offsetMs": 4,
    "operation": "selection.getSelection",
    "phase": "start",
    "details": {}
  }
}
```

Posting progress is best-effort with a short timeout and never replaces the Photoshop operation result. Electron accepts progress for pending and timed-out request IDs. A late final response is persisted as `bridge.uxp.lateResponse`, its missing trace events are ingested, and it is not delivered to an already rejected renderer promise.

The exported log contains successes as well as failures so timing, connection state, and the last known healthy operation can be compared.

## Retention and Export

Records are grouped into UTC-hour JSONL files. The retained interval is `[cutoff, snapshotTime]`, where `cutoff = snapshotTime - 24 hours`. On startup and after every append/prune/export operation, the logger removes files outside the rolling window and rewrites the cutoff-hour file after filtering individual records.

After cleanup, the logger schedules the next prune for the expiry instant of the oldest retained record. Electron also requests an immediate prune when the operating system resumes from sleep. This prevents expired records from remaining on disk while the app is idle.

Append, prune, scheduled expiry, resume cleanup, and export snapshot creation run on one serialized queue. Pruning and cutoff-file rewrites use a temporary file followed by rename so interrupted cleanup cannot corrupt the active log.

Settings shows a `下载诊断日志` action in the Electron desktop runtime. Export opens the native save dialog and writes one JSONL file containing:

1. an export metadata record with current runtime and retention window;
2. every valid diagnostic event from the last 24 hours, ordered by timestamp.

Export freezes one `snapshotTime` after prior writes drain, prunes against that time, reads and deterministically sorts by timestamp, request ID, sequence, and event ID, then writes through a temporary file followed by rename. The UI exposes `下载日志`, `正在整理`, and a concise success or failure result. Canceling the dialog returns to the idle state without an error.

## Error Handling

Logging failures never break the user operation being observed. Logger errors fall back to `console.error` and the app continues.

Malformed JSONL records are skipped during pruning and export. Their file name and line number are represented by a diagnostics warning record in the export when possible. Interrupted temporary files are removed during initialization.

UXP diagnostics are bounded to small metadata objects. Image pixels, masks, and previews are represented only by dimensions, counts, and byte lengths.

## Testing

Node built-in tests cover:

- recursive credential and binary-payload redaction;
- cutoff behavior at exactly 24 hours;
- pruning whole files and filtering the cutoff-hour file;
- export ordering and runtime metadata;
- malformed-record tolerance;
- error normalization for Windows filesystem and Photoshop-style errors.
- credentials embedded in URLs, headers, error messages, and stacks;
- concurrent append, prune, and export snapshot requests.

Bridge integration tests cover successful responses, structured failures, timeouts, late progress and responses, event deduplication, and canceled export dialogs.

Static and build verification cover:

- Vue and TypeScript compilation;
- UXP build and manifest verification;
- Settings props/emits contracts;
- packaged desktop contents.

Manual visual QA covers light and dark mode, narrow panel width, export progress, completion, failure, and cancellation states.

Before the Windows release is accepted, the packaged app and CCX must be exercised in real Windows Photoshop for successful selection capture, empty selection, and unsupported bit depth. Each case must export a log whose final completed stage and error fields match the observed result.

## Release Gate

After implementation tests pass, update all version-bearing files in the working tree to `0.3.12`, build and verify the current-platform package, and only then commit the version change. Version-bearing files include `package.json`, `package-lock.json`, both UXP manifests, `electron/main.js`, `src/buildInfo.ts`, `README.md`, `standalone-uxp-plugin/index.html`, `standalone-uxp-plugin/main.js`, and `standalone-uxp-plugin/package.mjs`.

Build and verify:

- `dist/release-0.3.12/lightyear-banana-0.3.12-mac.zip` on macOS;
- `dist/release-0.3.12/lightyear-banana-0.3.12-win.zip` on Windows;
- `dist/release-0.3.12/lightyear-banana-0.3.12.ccx`;
- `dist/release-0.3.12/SHA256SUMS.txt` covering all three packages.

The website release manifest and fallback links can move to `0.3.12` only after both native desktop packages, CCX, and checksums pass the documented gate.

The Windows packaging dispatch must state version `0.3.12`, target `lightyear-banana-0.3.12-win.zip`, the required returned archive, SHA256 verification, Windows Photoshop smoke cases, exported diagnostic log evidence, and whether `SHA256SUMS.txt` must be regenerated.

This repository currently has no `site/` directory and no `build:site` command. Website publication is recorded as externally blocked until the website source or deployment repository is available; local release artifacts may still be assembled without changing an online `latest.json`.

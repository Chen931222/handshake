# Implementation Plan: Handshake Audio Slice 2

## Overview

Wire the slice-1 modem/protocol/channel layers to real audio I/O and a browser demo.
Implementation order: RingBuffer (pure Node-testable) → AudioWorklet processors → AudioRx/AudioTx modules → BroadcastChannel path → demo and field pages. All modem arithmetic is reused from slice-1 without modification. No new runtime npm packages.

## Tasks

- [x] 1. Implement RingBuffer (`src/util/ring-buffer.ts`)
  - [x] 1.1 Create `src/util/ring-buffer.ts` with the `RingBuffer` class
    - Single `Float32Array` backing store of `capacity` elements; `_head` (index of oldest sample) and `_count` (number of valid samples) as private state
    - `constructor(capacity: number)`: throws `RangeError("capacity must be > 0")` if `capacity <= 0`
    - `write(samples: Float32Array)`: fills from `(this._head + this._count) % this._capacity`; when buffer is full, advances `_head` (overwrite-oldest)
    - `read(): Float32Array`: returns a copy in chronological order using up to two `Float32Array.prototype.set` calls to handle the wrap-around; does not modify the buffer
    - `clear(): void`: resets `_head = 0` and `_count = 0`
    - `get length(): number` and `get capacity(): number` accessors
    - Zero imports — no Web Audio API types anywhere in this file
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7_

  - [x]* 1.2 Write RingBuffer unit and property tests (`test/ring-buffer.test.ts`)
    - **Property 1: Round-trip, no overflow** — `fc.integer({ min: 10, max: 1000 })` for capacity; `fc.array` of `Float32Array` write sequences totalling ≤ capacity; assert `read()` returns all samples in write order
    - **Property 2: Overwrite-oldest on overflow** — write sequences totalling > capacity; assert `read()` returns last `capacity` samples in write order
    - **Property 3: Length invariant** — arbitrary `write()`/`clear()` sequences; assert `length ∈ [0, capacity]` after every operation
    - Unit: `RangeError` on `capacity = 0` and `capacity = -1`
    - Unit: `clear()` → `length === 0`, `read()` returns empty `Float32Array`
    - Unit: `read()` is non-destructive — calling twice returns equal arrays
    - Unit: multi-chunk writes produce contiguous result from `read()`
    - Unit: write exactly `capacity` samples; verify `length === capacity`, no overflow
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 8.1_

- [x] 2. Implement AudioWorklet TX processor (`src/channel/audio-tx-processor.ts`)
  - [x] 2.1 Create `src/channel/audio-tx-processor.ts` as a self-contained AudioWorkletProcessor
    - Class `TxProcessor extends AudioWorkletProcessor`; registered via `registerProcessor("handshake-tx", TxProcessor)`
    - Private state: `_buffer: Float32Array | null = null`, `_offset = 0`
    - `constructor()`: `this.port.onmessage = (e) => { this._buffer = e.data.samples; this._offset = 0; }`
    - `process(_inputs, outputs, _params)`: copies `Math.min(out.length, remaining)` samples into `outputs[0][0]`; zero-fills remainder; advances `_offset`; when buffer exhausted posts `{ done: true }` and returns `false`; returns `true` while data remains
    - No imports from outside `AudioWorkletGlobalScope` — file must be loadable as a worklet module
    - _Requirements: 2.2, 2.3, 2.4, 2.6_

- [x] 3. Implement AudioWorklet TX module (`src/channel/audio-tx.ts`)
  - [x] 3.1 Create `src/channel/audio-tx.ts` exporting `play(samples, ctx, options?): Promise<void>`
    - If `samples.length === 0`: resolve immediately without touching the AudioContext
    - Call `ctx.audioWorklet.addModule(workletUrl)` (default URL: `new URL('./audio-tx-processor.ts', import.meta.url)`)
    - Create `new AudioWorkletNode(ctx, "handshake-tx")`; connect to `ctx.destination`
    - Transfer samples: `node.port.postMessage({ samples }, [samples.buffer])`
    - Resolve when `node.port.onmessage` receives `{ done: true }`; disconnect node after resolve
    - Export `AudioTxOptions` interface (`workletUrl?: string`)
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6_

- [x] 4. Implement AudioWorklet RX processor (`src/channel/audio-rx-processor.ts`)
  - [x] 4.1 Create `src/channel/audio-rx-processor.ts` as a self-contained AudioWorkletProcessor
    - Class `RxProcessor extends AudioWorkletProcessor`; registered via `registerProcessor("handshake-rx", RxProcessor)`
    - `process(inputs, _outputs, _params)`: take `inputs[0]?.[0]`; if present and non-empty, `const copy = channel.slice(); this.port.postMessage({ chunk: copy }, [copy.buffer])`; always return `true`
    - No imports from outside `AudioWorkletGlobalScope`
    - _Requirements: 3.3_

- [x] 5. Implement AudioWorklet RX module (`src/channel/audio-rx.ts`)
  - [x] 5.1 Create `src/channel/audio-rx.ts` with the `AudioRx` class
    - Private event-listener map matching `RxEventMap`; `on(event, cb)` / `off(event, cb)` methods
    - `start(ctx: AudioContext): Promise<void>` sequence (must reject if `addModule` fails):
      1. If `window.isSecureContext === false`: emit `error` with `"requires-https"` and return
      2. Call injected `getUserMedia` (default: `navigator.mediaDevices.getUserMedia`) with `{ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } }`
      3. On `NotAllowedError`: emit `error` with `"permission-denied"` and return; on other errors: emit `error` with `error.message` and return
      4. `track.getSettings()` on first audio track → emit `constraint-report` with `ConstraintReport` object
      5. Determine `config`: use `options.config` if provided, else call `createConfig({ sampleRate: ctx.sampleRate, baudRate: defaultConfig.baudRate, markFrequency: defaultConfig.markFrequency, spaceFrequency: defaultConfig.spaceFrequency })`; log `console.warn` if `sampleRate` is not 44100 or 48000
      6. Allocate `RingBuffer` with capacity `Math.ceil(ctx.sampleRate * (149 * 8 / config.baudRate)) + ctx.sampleRate`
      7. Load worklet, create `AudioWorkletNode(ctx, "handshake-rx")`; connect `source → node` only (do NOT connect node to `ctx.destination`)
      8. `node.port.onmessage = ({ data }) => { ringBuffer.write(data.chunk); emitSignalLevel(); }` — throttle `signal-level` to one event per 50–100 ms using a timestamp guard
      9. `setInterval(poll, pollIntervalMs ?? 500)`: snapshot = `ringBuffer.read()`; call `receive(snapshot, config)`; on `ok: true` emit `payload` then `ringBuffer.clear()`
    - `stop()`: clear interval, disconnect node, stop all media tracks, cease emitting events
    - Export `AudioRxOptions`, `ConstraintReport`, `RxEventMap` interfaces
    - _Requirements: 1.1, 1.4, 3.0, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10, 3.11, 8.2, 8.4_

  - [x]* 5.2 Write polling and AudioRx unit tests (`test/polling.test.ts`)
    - Use `vi.useFakeTimers()`; inject fake `getUserMedia` returning a mock `MediaStream` with one audio track
    - Inject fake `AudioContext` and fake worklet so no real Web Audio API is needed
    - **Property 5: Polling emits payload on successful decode** — fast-check: `fc.uint8Array({ minLength: 1, maxLength: 140 })`; pre-populate ring buffer with `modulate(encodeFrame(payload), defaultConfig)`; advance 500 ms of fake time; assert `payload` callback fired exactly once with correct bytes; advance another 500 ms; assert no second emission
    - **Property 6: Polling does not clear on failed decode** — pre-populate ring buffer with random float noise; advance 500 ms; assert no `payload` event; assert `ringBuffer.length` unchanged
    - Unit: `start()` calls injected `getUserMedia` with `echoCancellation: false, noiseSuppression: false, autoGainControl: false`
    - Unit: `constraint-report` event fires with correct `{ requested: false, actual: … }` shape
    - Unit: `stop()` clears interval, disconnects node, stops mock tracks
    - Unit: `window.isSecureContext === false` → emits `"requires-https"` before `getUserMedia`
    - Unit: `NotAllowedError` from `getUserMedia` → emits `"permission-denied"`
    - _Requirements: 3.1, 3.2, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10, 8.2, 8.4_

- [x] 6. Checkpoint — ensure all RingBuffer and polling tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Implement BroadcastChannel path (`src/channel/broadcast.ts`)
  - [x] 7.1 Create `src/channel/broadcast.ts` with `broadcastSend` and `broadcastListen`
    - Both functions: check `typeof BroadcastChannel === "undefined"` and throw `Error("BroadcastChannel not supported")` if absent
    - `broadcastSend(payload, options)`: open `new BroadcastChannel(channelName ?? "handshake")`; call `encodeFrame(payload)` → `modulate(frame, config)` → `channel.postMessage({ samples: buf, sentAt: Date.now() }, [buf])` where `buf` is `samples.buffer`; close channel after post
    - `broadcastListen(options, onResult)`: open channel; `channel.onmessage = (e) => { const samples = new Float32Array(e.data.samples); const impaired = simulateChannel(samples, options.channelOptions ?? {}); onResult(receive(impaired, options.config)); }`; return unsubscribe function: `() => { channel.onmessage = null; channel.close(); }`
    - Export `BroadcastSendOptions` and `BroadcastListenOptions` interfaces
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6_

  - [x]* 7.2 Write BroadcastChannel unit and property tests (`test/broadcast.test.ts`)
    - Vitest runs in Node 18+ which provides a global `BroadcastChannel`
    - **Property 4: BroadcastChannel round-trip, no impairments** — `fc.uint8Array({ minLength: 1, maxLength: 140 })`; `snrDb: Infinity, clockDriftPpm: 0`; assert `onResult` receives `{ ok: true, payload }` byte-for-byte equal to original; `numRuns: 50`
    - Noise-resistance: `snrDb: 15`, `numRuns: 50`, `seed: 42`; assert result is `{ ok: true, payload: original }` or `{ ok: false }` — never `{ ok: true, payload: wrong }`
    - Unit: unsubscribe function prevents `onResult` from being called on subsequent messages
    - Unit: `broadcastSend` and `broadcastListen` throw `"BroadcastChannel not supported"` when `BroadcastChannel` deleted from global scope
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 8.3_

- [x] 8. Implement two-tab demo page (`demo.html` + `src/ui/demo.ts`)
  - [x] 8.1 Create `demo.html` with a module script tag pointing to `src/ui/demo.ts`
    - Semantic HTML: role toggles (Send / Listen), path toggles (Acoustic / Simulated), message `<textarea>`, byte counter `<span>`, Send `<button>`, SNR `<input type="range" min="-25" max="40" step="1" value="20">`, drift `<input type="number" value="0">`, `<meter>` for signal level, result `<div>`, elapsed `<div>`
    - SNR and drift controls visible only in Simulated mode; `<meter>` visible only in Listen + Acoustic mode
    - Fully offline: no CDN links, all code bundled by Vite
    - _Requirements: 6.1, 6.10_

  - [x] 8.2 Implement `src/ui/demo.ts` wiring all four operating modes
    - Create `AudioContext` on first user gesture (role/path selection or Send click); call `ctx.resume()` if suspended
    - Derive config once: `createConfig({ sampleRate: ctx.sampleRate, baudRate: defaultConfig.baudRate, markFrequency: defaultConfig.markFrequency, spaceFrequency: defaultConfig.spaceFrequency })`; log `console.warn` if `sampleRate` is not 44100 or 48000
    - Live byte counter: `TextEncoder.encode(text).byteLength` on every `input` event; `Send` button `disabled` when `byteCount === 0 || byteCount > 140`
    - **Send + Acoustic**: `TextEncoder` → `encodeFrame` → `modulate(config)` → `play(samples, ctx)`; show playback duration = `samples.length / ctx.sampleRate * 1000` ms
    - **Send + Simulated**: `broadcastSend(TextEncoder.encode(text), { config })`; `broadcastSend` frames once internally — do not call `encodeFrame` in the UI
    - **Listen + Acoustic**: `AudioRx.start(ctx)`; `signal-level` event → update `<meter>`; `payload` event → display decoded UTF-8 text with `✓ decode succeeded` label; `error` event → display reason; `constraint-report` → display constraint values
    - **Listen + Simulated**: `broadcastListen({ config, channelOptions: { snrDb, clockDriftPpm } }, onResult)`; re-subscribe when SNR or drift controls change; `onResult` → display `✓` / `✗` label, failure reason if any, elapsed time from `e.data.sentAt`
    - Elapsed time: Simulated path uses `Date.now() − message.sentAt`; Acoustic sender shows playback duration; Acoustic listener shows decoded frame duration; never compare `performance.now()` across tabs
    - _Requirements: 1.1, 1.4, 3.0, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8, 6.9, 6.10, 6.11_

- [x] 9. Implement field-measurement page (`field.html` + `src/ui/field.ts`)
  - [x] 9.1 Create `field.html` with a module script tag pointing to `src/ui/field.ts`
    - Form fields in order: `date`, `tx_device`, `rx_device`, `environment`, `distance_m`, `payload_bytes`, `attempts`, `successes`, `notes` (optional)
    - Results table with column headers: `date`, `tx_device`, `rx_device`, `environment`, `distance_m`, `payload_bytes`, `attempts`, `successes`, `notes`
    - "Add Row" submit button; "Download CSV" button
    - _Requirements: 7.1, 7.5_

  - [x] 9.2 Implement `src/ui/field.ts` with form logic, persistence, and CSV export
    - `date` auto-filled: `new Date().toISOString().slice(0, 10)`; remains editable
    - On submit: validate all required fields non-empty; validate `successes ≤ attempts` and `successes >= 0` and both are positive integers; display inline error per offending field; do not append row if validation fails
    - Valid row: push to `MeasurementRow[]` in-memory store; `localStorage.setItem("handshake-field-measurements", JSON.stringify(rows))`; re-render table; reset form (restore auto-filled date)
    - On `DOMContentLoaded`: read `localStorage.getItem("handshake-field-measurements")`; parse and restore all rows; render table
    - CSV export (extract as pure function `csvSerialize(rows: MeasurementRow[]): string`): header row `date,tx_device,rx_device,environment,distance_m,payload_bytes,attempts,successes,notes`; each value serialized per RFC 4180 (wrap in `"…"` if contains comma, double-quote, or newline; escape internal `"` as `""`); `Blob` with `type: "text/csv"`; `URL.createObjectURL` → programmatic `<a>` click → download `handshake-measurements.csv`
    - No network requests
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7_

  - [x]* 9.3 Write CSV serialization and localStorage round-trip tests (`test/field.test.ts`)
    - **Property 7: CSV quoting invariant** — `fc.record({ date: fc.string(), tx_device: fc.string(), … })` with string fields that may contain commas, double-quotes, and newlines; assert parsing the produced CSV per RFC 4180 recovers the original field values
    - **Property 8: localStorage round-trip** — `fc.array` of valid `MeasurementRow` objects; serialize to string and parse back; assert all fields equal
    - Unit: `successes > attempts` → validation error, row not appended
    - Unit: empty required field → validation error per field, row not appended
    - Unit: `csvSerialize([])` → header row only
    - _Requirements: 7.2, 7.4, 7.6_

- [x] 10. Final checkpoint — ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 11. Manual verification checklist (partly done: see Implementation notes)
  - Requirement 8.5 mandates the following manual browser verifications. These cannot be automated.

  **AudioWorklet TX:**
  - Open `demo.html` on `localhost`. Select Send + Acoustic. Type a short message. Click Send. Confirm an audible FSK tone sequence plays from the speaker.
  - Repeat on a 48000 Hz device (most laptops) and a 44100 Hz device (iOS Safari) if available. Confirm no pitch shift; both use whole-cycle configs.

  **AudioWorklet RX:**
  - Select Listen + Acoustic. Confirm the browser shows a microphone permission prompt.
  - Grant permission. Confirm the constraint report appears (note actual values for `echoCancellation`, `noiseSuppression`, `autoGainControl`).
  - Speak near the microphone. Confirm the signal-level meter responds.
  - Reload. Deny permission. Confirm `permission-denied` message appears; no crash.

  **HTTPS gate:**
  - Serve `demo.html` over plain HTTP on a non-localhost origin. Confirm `requires-https` message appears before any microphone permission prompt.

  **Two-tab acoustic round-trip:**
  - Open two tabs. Tab A: Send + Acoustic. Tab B: Listen + Acoustic.
  - Type a short message in Tab A. Click Send. Confirm Tab B decodes the text and shows elapsed time.
  - Repeat with a 140-byte message (~12 s audio). Confirm round-trip succeeds.

  **Two-tab simulated round-trip:**
  - Open two tabs. Tab A: Send + Simulated. Tab B: Listen + Simulated (SNR 20 dB, drift 0).
  - Confirm decode success and elapsed time is shown.
  - Reduce SNR to −10 dB; confirm occasional failure reason displayed (not a crash or wrong text).

  **Field-measurement page:**
  - Add several rows. Reload page. Confirm rows persist from `localStorage`.
  - Click Download CSV. Open in a spreadsheet. Confirm column headers and all values are correct.
  - Enter `successes > attempts`. Confirm inline error appears; row is not added.

  _Requirements: 8.5_

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP
- Slice-1 modules (`modulate`, `receive`, `simulateChannel`, `encodeFrame`, `decodeFrame`, `createConfig`, `defaultConfig`) are imported unchanged — do not modify them
- AudioWorklet processor files run in `AudioWorkletGlobalScope` and must have zero imports; they are manually verified in a browser, not in Vitest
- Property tests use `numRuns: 100` (or 50 where noted); noise tests use `seed: 42` for reproducibility
- `configForSampleRate` functionality lives in the callers (`audio-rx.ts`, `demo.ts`) via `createConfig` + `defaultConfig` — no separate helper file needed; magic numbers must not appear in this slice
- The `signal-level` event is throttled to one event per 50–100 ms; raw audio quanta arrive every ~2.9 ms at 44100 Hz
- `broadcastSend` frames once internally; callers never call `encodeFrame` before passing to `broadcastSend`

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "2.1", "4.1", "7.1", "9.1"] },
    { "id": 1, "tasks": ["1.2", "3.1", "5.1", "7.2", "9.2"] },
    { "id": 2, "tasks": ["5.2", "8.1", "9.3"] },
    { "id": 3, "tasks": ["8.2"] }
  ]
}
```

## Implementation notes (2026-11-13)

- Implemented outside Kiro with another coding assistant, following this task list, after the free tier's credits ran out. Tests: `test/slice2.test.ts`, `test/clarity.test.ts` (94 tests in the suite pass).
- Deviations, each for a stated reason:
  - The worklet processors are plain `.js` (`src/channel/audio-*-processor.js`): they run in AudioWorkletGlobalScope and are loaded by URL, so Vite must not compile or inline them (`assetsInlineLimit` keeps them as files).
  - `src/channel/rate-config.ts` holds `configForSampleRate()` and `rxBufferCapacity()` so the literal-free config is built in one place instead of in two callers.
  - `src/modem/clarity.ts` adds `toneClarity()`: the measured share of energy on the modem tones, which drives the séance lens. The BroadcastChannel result and the receiver's signal-level event both carry it.
  - The two-tab demo is the main screen (`index.html`); the slice-1 dev page moved to `lab.html`.
- Task 11 (manual checks): two-tab path verified in a browser (decode at 20 dB, GOOD BYE + no_sync at −20 dB); the Web Audio path verified by loopback (TX worklet → MediaStream → RX worklet) at 48 kHz and 44.1 kHz. **Not yet verified: speaker → air → microphone, and real phones.**

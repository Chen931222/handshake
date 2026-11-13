# Design Document

## Overview

Slice-2 adds real audio I/O and a browser-based demonstration to the Handshake data-over-sound
pipeline. Slice-1 delivered the pure modem/protocol/simulated-channel layers as self-contained
TypeScript modules; this slice wires those layers to two new surfaces:

1. **Audio I/O** — an AudioWorklet transmitter that plays pre-computed `Float32Array` samples
   through the device speaker, and an AudioWorklet receiver that captures microphone input,
   buffers it in a ring buffer, and polls `receive()` every 500 ms.
2. **BroadcastChannel path** — a simulated-channel demo path that passes modulated samples
   between browser tabs over `BroadcastChannel`, allowing a full round-trip demo on a single
   laptop without a microphone.
3. **Demo page** (`demo.html` / `src/ui/demo.ts`) — role and path selector, live signal meter,
   elapsed-time display, and decode result area.
4. **Field-measurement page** (`field.html` / `src/ui/field.ts`) — structured form for recording
   real-world transmission attempts, `localStorage` persistence, and CSV export.

A new `src/util/ring-buffer.ts` module provides the circular buffer used by the receiver; it has
no Web Audio dependency and is fully exercisable under Vitest in a Node environment.

All modem arithmetic (`modulate`, `receive`, `simulateChannel`, `createConfig`, `defaultConfig`,
`encodeFrame`, `decodeFrame`) is reused from slice-1 without modification. No new runtime npm
packages are introduced.

---

## Architecture

### Module / file structure

```
src/
  modem/
    config.ts              [slice-1] ModemConfig, createConfig(), defaultConfig
    modulator.ts           [slice-1] modulate(bytes, config): Float32Array
    demodulator.ts         [slice-1] demodulateBits, demodulate
    receiver.ts            [slice-1] receive(samples, config): DecodeResult
  protocol/
    frame.ts               [slice-1] encodeFrame, decodeFrame, DecodeResult, FailureReason
  channel/
    simulated.ts           [slice-1] simulateChannel(samples, options): Float32Array
    audio-tx.ts            AudioWorklet transmitter — main-thread API
    audio-tx-processor.ts  AudioWorkletProcessor for TX (runs in worklet scope)
    audio-rx.ts            AudioWorklet receiver + ring-buffer polling — main-thread API
    audio-rx-processor.ts  AudioWorkletProcessor for RX (runs in worklet scope)
    broadcast.ts           BroadcastChannel send/receive path
  util/
    ring-buffer.ts         Fixed-capacity circular Float32Array buffer (no Web Audio)
  ui/
    demo.ts                Two-tab demo page logic
    field.ts               Field-measurement page logic
  main.ts                  [slice-1] Dev page entry point
index.html                 [slice-1] Dev page
demo.html                  Two-tab demo page
field.html                 Field-measurement page
test/
  modem.test.ts            [slice-1] Modem properties and unit tests
  protocol.test.ts         [slice-1] Protocol properties and unit tests
  noise.test.ts            [slice-1] Noise-resistance and channel properties
  receiver.test.ts         [slice-1] Receiver tests
  channel.test.ts          [slice-1] Simulated channel tests
  ring-buffer.test.ts      RingBuffer properties and unit tests
  polling.test.ts          AudioRx polling loop (fake timers)
  broadcast.test.ts        BroadcastChannel round-trip and unsubscribe tests
```

### Layer dependency rules

```
util/ring-buffer.ts ────────────► (nothing — no imports at all)

modem/* ─────────────────────────► (nothing)
protocol/* ──────────────────────► (nothing)
channel/simulated.ts ────────────► modem (config types only)

channel/audio-tx-processor.ts ──► (nothing outside AudioWorkletGlobalScope built-ins)
channel/audio-rx-processor.ts ──► (nothing outside AudioWorkletGlobalScope built-ins)

channel/audio-tx.ts ─────────────► (no modem/protocol imports needed; receives samples as Float32Array)
channel/audio-rx.ts ─────────────► modem/receiver, modem/config, util/ring-buffer
channel/broadcast.ts ────────────► modem/modulator, modem/config, channel/simulated, protocol/frame, modem/receiver

ui/demo.ts ──────────────────────► channel/audio-tx, channel/audio-rx, channel/broadcast,
                                    modem/config, modem/modulator, protocol/frame, modem/receiver
ui/field.ts ─────────────────────► (no modem/channel imports; pure DOM + localStorage)
```

**Rules:**
- `util/ring-buffer.ts` has zero imports; it must be exercisable in Node without any polyfill.
- AudioWorklet processor files (`audio-tx-processor.ts`, `audio-rx-processor.ts`) run inside
  `AudioWorkletGlobalScope` and may not import anything outside the worklet scope. They are
  self-contained and use only the built-in `AudioWorkletProcessor` base class and `port`.
- No layer may import from a layer above it (ui imports channel; channel imports modem/protocol;
  modem and protocol import nothing).
- `audio-tx.ts` and `audio-rx.ts` depend on Web Audio API types only through injected
  constructor parameters or factory options, so unit tests can substitute stubs.

---

## Data Flow

### TX path (acoustic)

```
string
  │  TextEncoder
  ▼
Uint8Array (UTF-8, 1–140 bytes)
  │  encodeFrame()
  ▼
Uint8Array (preamble + sync + length + payload + CRC)
  │  modulate(config @ audioContext.sampleRate)
  ▼
Float32Array (audio samples at native sample rate)
  │  play(samples, ctx)   ← audio-tx.ts
  │    AudioWorkletNode (audio-tx-processor.ts)
  │    port.postMessage({ samples }, [samples.buffer])
  │    process() copies blockSize samples per render quantum
  ▼
Speaker output
```

### RX path (acoustic)

```
Microphone
  │  getUserMedia({ echoCancellation: false, noiseSuppression: false, autoGainControl: false })
  ▼
MediaStreamTrack
  │  AudioWorkletNode (audio-rx-processor.ts)
  │  process() posts Float32Array chunks via port
  ▼
Main thread (audio-rx.ts port.onmessage)
  │  RingBuffer.write(chunk)
  ▼
Ring buffer (capacity ≥ max-frame-duration + 1 s of audio)
  │
  │  setInterval every 500 ms
  ▼
snapshot = RingBuffer.read()
  │  receive(snapshot, config)
  ▼
DecodeResult
  ├─ { ok: true,  payload } → emit "payload" event + RingBuffer.clear()
  └─ { ok: false, reason  } → continue polling (buffer NOT cleared)
  ▼
UI (demo.ts)
```

### BroadcastChannel TX/RX path

```
Sender tab:
  Uint8Array payload
    │  encodeFrame → modulate(config)
    ▼
  Float32Array
    │  transfer as ArrayBuffer via BroadcastChannel "handshake"
    ▼
  BroadcastChannel.postMessage({ samples: ArrayBuffer }, [ArrayBuffer])

Receiver tab:
  BroadcastChannel "handshake" message
    │  new Float32Array(event.data.samples)
    │  simulateChannel(samples, { snrDb, clockDriftPpm, … })
    │  receive(impairedSamples, config)
    ▼
  DecodeResult → onResult(result)
```

---

## Components and Interfaces

### src/util/ring-buffer.ts

```typescript
/**
 * Fixed-capacity circular buffer of Float32 audio samples.
 * Has no dependency on any Web Audio API type.
 * Overwrites the oldest samples when written past capacity.
 */
export class RingBuffer {
  constructor(capacity: number);
  // throws RangeError if capacity <= 0

  /**
   * Append samples to the buffer.
   * If total samples would exceed capacity, oldest samples are silently overwritten.
   */
  write(samples: Float32Array): void;

  /**
   * Return a copy of the currently buffered samples in chronological order (oldest first).
   * Does NOT modify the buffer; calling read() twice returns the same data.
   */
  read(): Float32Array;

  /** Reset the buffer; length returns 0 immediately after. */
  clear(): void;

  /** Number of valid samples currently held; always in [0, capacity]. */
  get length(): number;

  /** The fixed capacity passed to the constructor. */
  get capacity(): number;
}
```

**Implementation note:** Internally holds a single `Float32Array` of `capacity` elements plus
two integer state variables: `_head` (index of the oldest sample) and `_count` (number of
valid samples). `write` fills from `(this._head + this._count) % this._capacity`, advancing
`_head` when the buffer is full. `read` copies from `_head` in up to two contiguous memcpy
segments to handle the wrap-around case (using `Float32Array.prototype.set`).

---

### src/channel/audio-tx-processor.ts (AudioWorkletProcessor)

Runs entirely in `AudioWorkletGlobalScope`. No imports from outside the worklet.

```typescript
// audio-tx-processor.ts
// Registered as "handshake-tx" via registerProcessor().

class TxProcessor extends AudioWorkletProcessor {
  private _buffer: Float32Array | null = null;
  private _offset = 0;

  constructor() {
    super();
    this.port.onmessage = (e: MessageEvent) => {
      // Receives { samples: Float32Array } transferred from main thread.
      this._buffer = e.data.samples;
      this._offset = 0;
    };
  }

  process(
    _inputs: Float32Array[][],
    outputs: Float32Array[][],
    _parameters: Record<string, Float32Array>
  ): boolean {
    const out = outputs[0][0];
    if (this._buffer === null || this._offset >= this._buffer.length) {
      // No data or fully exhausted: post done signal and stop.
      if (this._buffer !== null && this._offset >= this._buffer.length) {
        this.port.postMessage({ done: true });
        this._buffer = null;
      }
      out.fill(0);
      return this._buffer !== null; // false when done
    }
    const remaining = this._buffer.length - this._offset;
    const toCopy = Math.min(out.length, remaining);
    out.set(this._buffer.subarray(this._offset, this._offset + toCopy));
    if (toCopy < out.length) {
      out.fill(0, toCopy);
    }
    this._offset += toCopy;
    return true; // keep alive while there is still data
  }
}

registerProcessor("handshake-tx", TxProcessor);
```

The processor transfers ownership of the `Float32Array` buffer from the main thread via
`port.postMessage(data, [data.buffer])` to avoid copying. When the buffer is exhausted,
the processor posts `{ done: true }` and returns `false`, which signals the Web Audio engine
to release the node.

---

### src/channel/audio-tx.ts

```typescript
export interface AudioTxOptions {
  /**
   * URL of the AudioWorklet processor module.
   * Defaults to new URL('./audio-tx-processor.ts', import.meta.url),
   * which Vite resolves to the correct bundled URL at build time.
   */
  workletUrl?: string;
}

/**
 * Play pre-computed audio samples through an AudioWorkletNode.
 *
 * @param samples  The Float32Array to play. If empty, resolves immediately.
 * @param ctx      The AudioContext to play through (must be in "running" state).
 * @param options  Optional configuration.
 * @returns        A Promise that resolves when all samples have been delivered to the speaker.
 */
export async function play(
  samples: Float32Array,
  ctx: AudioContext,
  options?: AudioTxOptions
): Promise<void>;
```

**Implementation notes:**
- If `samples.length === 0`, the function resolves immediately without creating an
  `AudioWorkletNode`.
- The function calls `ctx.audioWorklet.addModule(workletUrl)` once per URL (browsers cache
  it; calling `addModule` with the same URL again is a no-op per the spec).
- After `addModule` resolves, it creates `new AudioWorkletNode(ctx, "handshake-tx")`, connects
  it to `ctx.destination`, then calls `node.port.postMessage({ samples }, [samples.buffer])`
  to transfer ownership.
- The returned `Promise` is resolved when the node's port fires `{ done: true }`.
- After resolution the node is disconnected from `ctx.destination`.
- Does not use `ScriptProcessorNode`.

---

### src/channel/audio-rx-processor.ts (AudioWorkletProcessor)

Runs entirely in `AudioWorkletGlobalScope`. No imports from outside the worklet.

```typescript
// audio-rx-processor.ts
// Registered as "handshake-rx" via registerProcessor().
// Forwards every render quantum from the microphone input to the main thread via port.

class RxProcessor extends AudioWorkletProcessor {
  process(
    inputs: Float32Array[][],
    _outputs: Float32Array[][],
    _parameters: Record<string, Float32Array>
  ): boolean {
    const channel = inputs[0]?.[0];
    if (channel && channel.length > 0) {
      // Transfer ownership to avoid copying where possible.
      const copy = channel.slice(); // slice creates a new buffer
      this.port.postMessage({ chunk: copy }, [copy.buffer]);
    }
    return true; // always keep alive
  }
}

registerProcessor("handshake-rx", RxProcessor);
```

**Note:** The processor always returns `true` and keeps running until `stop()` is called on
the main thread (which disconnects the node). Using `port.postMessage` with transferable
`ArrayBuffer` avoids a copy across the thread boundary.

---

### src/channel/audio-rx.ts

```typescript
import type { ModemConfig } from "../modem/config";
import type { DecodeResult } from "../protocol/frame";

export interface ConstraintReport {
  echoCancellation: { requested: false; actual: boolean };
  noiseSuppression:  { requested: false; actual: boolean };
  autoGainControl:   { requested: false; actual: boolean };
}

export type RxEventMap = {
  payload:            Uint8Array;
  error:              string;              // "permission-denied" | "requires-https" | ...
  "constraint-report": ConstraintReport;
  "signal-level":     number;             // RMS of most recent 2048 samples
};

export interface AudioRxOptions {
  /** ModemConfig to use for receive(). Defaults to createConfig(ctx.sampleRate, ...). */
  config?: ModemConfig;
  /** Polling interval in ms. Default: 500. */
  pollIntervalMs?: number;
  /** URL of the AudioWorklet processor module. */
  workletUrl?: string;
  /**
   * Injectable getUserMedia factory for testing.
   * Default: (constraints) => navigator.mediaDevices.getUserMedia(constraints)
   */
  getUserMedia?: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
}

export class AudioRx {
  constructor(options?: AudioRxOptions);

  /**
   * Request microphone access, load the AudioWorklet, and begin polling.
   * Emits "constraint-report" once the stream is obtained.
   * Rejects if the AudioWorklet module fails to load.
   * Does not reject on getUserMedia failure — emits "error" instead.
   */
  async start(ctx: AudioContext): Promise<void>;

  /** Stop polling, disconnect the AudioWorkletNode, and stop all media tracks. */
  stop(): void;

  on(event: "payload",            cb: (payload: Uint8Array) => void): void;
  on(event: "error",              cb: (reason: string) => void): void;
  on(event: "constraint-report",  cb: (report: ConstraintReport) => void): void;
  on(event: "signal-level",       cb: (rms: number) => void): void;

  off(event: keyof RxEventMap, cb: Function): void;
}
```

**`start()` implementation sequence:**
1. If `window.isSecureContext` is false, emit `{ type: "error", reason: "requires-https" }` and return.
2. Call `getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } })`.
3. On `NotAllowedError`, emit `{ type: "error", reason: "permission-denied" }` and return.
4. Call `track.getSettings()` on the first audio track; compare each of `echoCancellation`,
   `noiseSuppression`, and `autoGainControl` against the requested value (`false`); emit
   `"constraint-report"`.
5. Determine `config`: if `options.config` is provided use it, else call
   `createConfig({ sampleRate: ctx.sampleRate, baudRate: defaultConfig.baudRate, markFrequency: defaultConfig.markFrequency, spaceFrequency: defaultConfig.spaceFrequency })` — never literal numbers.
   If the sample rate is not 44100 or 48000, log a warning (Requirement 1.4).
6. Allocate a `RingBuffer` with capacity `Math.ceil(ctx.sampleRate * (149 * 8 / config.baudRate)) + ctx.sampleRate` (149 = longest frame in bytes).
7. Call `ctx.audioWorklet.addModule(workletUrl)`.
8. Create `new AudioWorkletNode(ctx, "handshake-rx")`; connect `source → node` (do not connect
   node to `ctx.destination`; the microphone signal must not play back through the speaker).
9. `node.port.onmessage = ({ data }) => { ringBuffer.write(data.chunk); emitSignalLevel(); }`.
10. Start `setInterval(poll, pollIntervalMs)` where `poll()`:
    - Takes a snapshot: `const snap = ringBuffer.read()`.
    - Calls `receive(snap, config)`.
    - If `ok: true`: emit `"payload"`, call `ringBuffer.clear()`.
    - If `ok: false`: do nothing (buffer not cleared).

**`stop()` sequence:** clear the interval, disconnect the `AudioWorkletNode`, stop all tracks
of the `MediaStream`, and cease emitting events.

---

### src/channel/broadcast.ts

```typescript
import type { ModemConfig } from "../modem/config";
import type { ChannelOptions } from "./simulated";
import type { DecodeResult } from "../protocol/frame";

export interface BroadcastSendOptions {
  /** ModemConfig to use for modulate(). Required. */
  config: ModemConfig;
  /** BroadcastChannel name. Default: "handshake". */
  channelName?: string;
}

export interface BroadcastListenOptions {
  /** ModemConfig to use for receive(). Required. */
  config: ModemConfig;
  /** BroadcastChannel name. Default: "handshake". */
  channelName?: string;
  /** Channel impairment options passed to simulateChannel(). Default: {} (no impairments). */
  channelOptions?: ChannelOptions;
}

/**
 * Encode and transmit payload over BroadcastChannel.
 * encodeFrame → modulate → posts { samples: ArrayBuffer } transferably.
 * Throws Error("BroadcastChannel not supported") if BroadcastChannel is unavailable.
 */
export function broadcastSend(
  payload: Uint8Array,
  options: BroadcastSendOptions
): void;

/**
 * Listen for frames on BroadcastChannel.
 * On each message: deserialize → simulateChannel → receive → onResult(result).
 * Returns an unsubscribe function that removes the listener and closes the channel.
 * Throws Error("BroadcastChannel not supported") if BroadcastChannel is unavailable.
 */
export function broadcastListen(
  options: BroadcastListenOptions,
  onResult: (result: DecodeResult) => void
): () => void;
```

**Implementation notes:**
- `broadcastSend` calls `encodeFrame(payload)`, then `modulate(frame, config)`, then
  `channel.postMessage({ samples: buf }, [buf])` where `buf` is the underlying `ArrayBuffer`.
  Transferring the buffer avoids copying multi-hundred-kilobyte sample arrays across threads.
- `broadcastListen` registers `channel.onmessage`; on each event it reconstructs
  `new Float32Array(event.data.samples)`, applies `simulateChannel(samples, channelOptions)`,
  calls `receive(impaired, config)`, and calls `onResult`.
- Both functions check `typeof BroadcastChannel !== "undefined"` at the top and throw the
  documented error if absent.
- The unsubscribe function returned by `broadcastListen` sets `channel.onmessage = null` and
  calls `channel.close()`.

---

### demo.html + src/ui/demo.ts

The demo page is a pure client-side, offline-capable page served from `demo.html` and bundled
by Vite.

**UI layout:**

```
┌────────────────────────────────────────────────────────┐
│ Handshake — two-tab demo                               │
│                                                        │
│ Role:  [Send ●]  [Listen]    Path: [Acoustic ●]  [Sim] │
│                                                        │
│ Message: [________________________________]  n / 140   │
│ [Send]  (disabled when n=0 or n>140)                   │
│                                                        │
│ SNR: [20 dB ▲▼]   Drift: [0 ppm]   ← Simulated only   │
│                                                        │
│ Signal: ████████░░░░░░░░  ← Listen + Acoustic only     │
│                                                        │
│ Result: ✓ decode succeeded — "hello world"             │
│         Elapsed: 12 341 ms                             │
│    — or —                                              │
│         ✗ decode failed — crc_mismatch                 │
│         Elapsed: 12 341 ms                             │
└────────────────────────────────────────────────────────┘
```

**State machine:**

The UI has two orthogonal selectors — `role ∈ { send, listen }` and `path ∈ { acoustic, simulated }` — which give four operating modes. Only controls relevant to the active mode are visible.

| Mode | Active controls |
|---|---|
| Send + Acoustic | Message input, Send button |
| Send + Simulated | Message input, Send button |
| Listen + Acoustic | Signal meter, result area |
| Listen + Simulated | SNR slider (−25 to 40 dB), Drift input, result area |

**Key implementation details:**

- An `AudioContext` is created on the first user gesture (required by browsers). `createConfig`
  is called once using `audioContext.sampleRate`; this single config object is reused for the
  entire session.
- **Send + Acoustic:** `TextEncoder` → `encodeFrame` → `modulate(config)` → `play(samples, ctx)`.
  Elapsed timer starts at the Send click and stops when `play` resolves (all samples delivered
  to the worklet; actual speaker output may lag slightly).
- **Send + Simulated:** `TextEncoder` → `broadcastSend(payload, { config })`. The page does NOT call
  `encodeFrame`; `broadcastSend` frames exactly once (calling it twice would make the listener
  "decode" the inner frame's raw bytes as text).
- **Listen + Acoustic:** `AudioRx.start(ctx)`. The `signal-level` event drives a `<meter>`
  element; the `payload` event displays decoded UTF-8 text; the `error` event displays the
  reason string.
- **Listen + Simulated:** `broadcastListen({ config, channelOptions: { snrDb, clockDriftPpm } }, onResult)`.
  The SNR slider and drift input feed `channelOptions` in real time (the unsubscribe/re-listen
  cycle happens when the user changes the values).
- **Signal meter:** the `signal-level` event carries the RMS of the most recent 2048 samples.
  The `<meter>` min/max is 0–1 (normalized audio range). Chunks arrive every render quantum
  (~2.9 ms at 44100 Hz), but `signal-level` is throttled to one event per 50–100 ms.
- **Timing:** `performance.now()` has a different origin in every tab, so it is never compared
  across tabs. Simulated path: the message carries `sentAt: Date.now()` and the listener shows
  `Date.now() − sentAt`. Acoustic path: the sender shows playback duration (frame bits ÷ baud);
  the listener shows the decoded frame's duration.
- **Offline:** all code is bundled by Vite; `demo.html` has no runtime CDN or fetch calls.
- **Byte counter:** `TextEncoder.encode(text).byteLength` is recomputed on every `input` event.
  The Send button's `disabled` property mirrors `byteCount === 0 || byteCount > 140`.

---

### field.html + src/ui/field.ts

The field-measurement page is a standalone page served from `field.html`.

**UI layout:**

```
┌────────────────────────────────────────────────────────┐
│ Handshake — field measurements                         │
│                                                        │
│ Date: [2026-11-12]  TX device: [iPhone 15 Pro]         │
│ RX device: [Pixel 8]  Environment: [office, 1 m]       │
│ Distance (m): [1.5]  Payload (bytes): [32]             │
│ Attempts: [5]  Successes: [4]  Notes: [optional]       │
│ [Add Row]                                              │
│                                                        │
│ date | tx_device | rx_device | environment |           │
│ distance_m | payload_bytes | attempts | successes |    │
│ notes                          [Download CSV]          │
└────────────────────────────────────────────────────────┘
```

**Key implementation details:**

- The `date` field is auto-filled with `new Date().toISOString().slice(0, 10)` (the current
  local date in ISO format) but remains editable.
- Validation on submit: all fields except `notes` must be non-empty; `successes` must be a
  non-negative integer ≤ `attempts`. Inline error messages appear next to the offending field.
- Rows are stored as an array of plain objects in `localStorage` under the key
  `"handshake-field-measurements"` via `JSON.stringify`/`JSON.parse`. The page loads and
  restores all rows on `DOMContentLoaded`.
- **CSV export:** fields are serialized per RFC 4180 — values containing commas, double-quotes,
  or newlines are wrapped in double-quotes, with any embedded double-quotes escaped as `""`.
  The `Download CSV` button creates a `Blob` with MIME type `text/csv`, attaches it to a
  temporary `<a>` element, and triggers a programmatic click to download
  `handshake-measurements.csv`.
- Column order: `date, tx_device, rx_device, environment, distance_m, payload_bytes, attempts, successes, notes`.
- No network requests; all data is local.

---

## Data Models

```typescript
// ── Shared with slice-1 (unchanged) ───────────────────────────────────────────

interface ModemConfig {
  sampleRate: number;
  baudRate: number;
  markFrequency: number;
  spaceFrequency: number;
  samplesPerSymbol: number;  // derived
}

type DecodeResult =
  | { ok: true;  payload: Uint8Array }
  | { ok: false; reason: "no_sync" | "bad_length" | "crc_mismatch" };

interface ChannelOptions {
  snrDb?: number;
  gainMin?: number;
  gainMax?: number;
  clockDriftPpm?: number;
  rng?: () => number;
  leadingSilenceSamples?: number;
  trailingSilenceSamples?: number;
}

// ── New in slice-2 ────────────────────────────────────────────────────────────

interface ConstraintReport {
  echoCancellation: { requested: false; actual: boolean };
  noiseSuppression:  { requested: false; actual: boolean };
  autoGainControl:   { requested: false; actual: boolean };
}

/** One row in the field-measurement table. */
interface MeasurementRow {
  date:           string;   // ISO date, e.g. "2026-11-12"
  tx_device:      string;
  rx_device:      string;
  environment:    string;
  distance_m:     number;
  payload_bytes:  number;
  attempts:       number;   // positive integer
  successes:      number;   // non-negative integer ≤ attempts
  notes:          string;   // may be empty
}
```

No persistent data model beyond `MeasurementRow[]` stored in `localStorage`. All modem/channel
data flows through function arguments and return values.

---

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions
of a system — essentially, a formal statement about what the system should do. Properties
serve as the bridge between human-readable specifications and machine-verifiable correctness
guarantees.*

### Property 1: RingBuffer round-trip (no overflow)

*For any* capacity `C > 0` and any sequence of `write()` calls whose total sample count `N`
satisfies `N ≤ C`, `read()` returns a `Float32Array` of length `N` containing every written
sample in the original write order (oldest sample first).

**Validates: Requirements 4.2, 4.4**

---

### Property 2: RingBuffer overwrite-oldest (overflow)

*For any* capacity `C > 0` and any sequence of `write()` calls whose total sample count `N`
exceeds `C`, `read()` returns a `Float32Array` of length `C` containing exactly the last `C`
written samples in write order.

**Validates: Requirements 4.3**

---

### Property 3: RingBuffer length invariant

*For any* capacity `C > 0` and any sequence of `write()` and `clear()` calls,
`ringBuffer.length` is always in the closed interval `[0, C]`.

**Validates: Requirements 4.6**

---

### Property 4: BroadcastChannel round-trip (no impairments)

*For any* `Uint8Array` payload of length 1–140, calling `broadcastSend(payload, { config })`
followed by `broadcastListen({ config, channelOptions: { snrDb: Infinity, clockDriftPpm: 0 } }, onResult)`
causes `onResult` to be called with `{ ok: true, payload: p }` where `p` is byte-for-byte
equal to the original `payload`.

**Validates: Requirements 5.3, 8.3**

---

### Property 5: Polling emits payload on successful decode

*For any* valid payload (1–140 bytes), when the `AudioRx` ring buffer is pre-populated with
the samples of `modulate(encodeFrame(payload), config)` and the polling interval fires once
(500 ms of fake time), the receiver emits a `"payload"` event exactly once carrying a
`Uint8Array` byte-for-byte equal to the original `payload`, and the ring buffer is cleared
(subsequent ticks produce no further `"payload"` events).

**Validates: Requirements 3.5, 3.6, 8.2**

---

### Property 6: Polling does not clear buffer on failed decode

*For any* `Float32Array` of samples that `receive()` returns `{ ok: false }` for, after one
500 ms polling tick the `AudioRx` instance emits no `"payload"` event and the ring buffer
length is unchanged.

**Validates: Requirements 3.7**

---

### Property 7: CSV quoting invariant

*For any* `MeasurementRow` whose string fields may contain commas, double-quotes, or newlines,
the CSV serialization wraps each such field in double-quotes and escapes internal double-quotes
as `""`, such that parsing the resulting CSV per RFC 4180 recovers the original field values.

**Validates: Requirements 7.6**

---

### Property 8: Field-measurement localStorage round-trip

*For any* array of valid `MeasurementRow` objects, serializing to `localStorage` and
deserializing on page reload recovers all rows with every field value unchanged.

**Validates: Requirements 7.4**

---

## Error Handling

| Situation | Location | Behavior |
|---|---|---|
| `capacity ≤ 0` | `RingBuffer` constructor | throws `RangeError("capacity must be > 0")` |
| Ring buffer overflow | `RingBuffer.write` | silently overwrites oldest samples (by design; documented) |
| `window.isSecureContext` is false | `AudioRx.start` | emits `{ type: "error", reason: "requires-https" }` before calling `getUserMedia` |
| `getUserMedia` rejected with `NotAllowedError` | `AudioRx.start` | emits `{ type: "error", reason: "permission-denied" }`; does not retry |
| `getUserMedia` rejected with any other error | `AudioRx.start` | emits `{ type: "error", reason: error.message }` |
| AudioWorklet `addModule` failure | `play()` / `AudioRx.start` | propagates as rejected `Promise` to caller |
| `samples.length === 0` passed to `play()` | `audio-tx.ts` | resolves immediately without creating `AudioWorkletNode` |
| `BroadcastChannel` not in global scope | `broadcastSend` / `broadcastListen` | throws `Error("BroadcastChannel not supported")` |
| `successes > attempts` in field form | `field.ts` form submit handler | displays inline error; row not appended |
| Required field empty in field form | `field.ts` form submit handler | displays inline error per field; row not appended |
| Unusual `sampleRate` (not 44100 or 48000) | `AudioRx.start`, `demo.ts` | logs `console.warn` naming the value; proceeds with actual `sampleRate` |

---

## Testing Strategy

### Framework

- **Vitest** for test runner (already configured).
- **fast-check** for property-based tests (already a dev-dependency).
- Property tests: `numRuns: 100` minimum.
- Tag format per test: `// Feature: handshake-audio-slice-2, Property N: <property text>`

### test/ring-buffer.test.ts

- **Property 1** (round-trip, no overflow) — fast-check:
  `fc.integer({ min: 10, max: 1000 })` for capacity, `fc.array(fc.float32Array(…))` for write
  sequences totaling ≤ capacity. Assert `read()` returns all samples in order.
- **Property 2** (overwrite-oldest) — fast-check: write sequences totaling > capacity.
  Assert `read()` returns last `capacity` samples in order.
- **Property 3** (length invariant) — fast-check: arbitrary write/clear sequences.
  Assert `length ∈ [0, capacity]` after every operation.
- Unit: `RangeError` on `capacity = 0` and `capacity = -1`.
- Unit: `clear()` → `length === 0`, `read()` returns empty `Float32Array`.
- Unit: `read()` is non-destructive — calling twice returns equal arrays.
- Unit: write in multiple chunks, verify `read()` returns contiguous result.

### test/polling.test.ts

Uses `vi.useFakeTimers()` and injected stubs for `AudioContext` / `getUserMedia`.

- **Property 5** (polling emits payload on success):
  - Create `AudioRx` with injected fake `getUserMedia` that returns a mock `MediaStream`.
  - Pre-populate internal `RingBuffer` with samples from
    `modulate(encodeFrame(payload), defaultConfig)`.
  - `vi.advanceTimersByTime(500)` → assert `payload` callback fired exactly once with correct bytes.
  - Advance another 500 ms → assert no second emission.
- **Property 6** (polling does not clear on failure):
  - Pre-populate ring buffer with random noise.
  - Advance 500 ms → assert no `payload` event, assert `ringBuffer.length` unchanged.
- Unit: `start()` calls injected `getUserMedia` with `echoCancellation: false`.
- Unit: `constraint-report` event fires with correct `{ requested: false, actual: … }` shape.
- Unit: `stop()` clears interval and stops mock tracks.
- Unit: origin check emits `"requires-https"` before `getUserMedia` on non-HTTPS origin.
- Unit: `NotAllowedError` from `getUserMedia` emits `"permission-denied"`.

### test/broadcast.test.ts

Vitest runs in Node 18+, which provides a global `BroadcastChannel`.

- **Property 4** (BroadcastChannel round-trip, no impairments) — fast-check:
  `fc.uint8Array({ minLength: 1, maxLength: 140 })`. Assert `onResult` receives
  `{ ok: true, payload }` byte-for-byte equal to original.
- Unit: round-trip with moderate noise (`snrDb: 15`) returns either `ok: true` with correct
  payload or `ok: false` — never wrong data (noise resistance, never silent wrong accept).
- Unit: calling the unsubscribe function returned by `broadcastListen` prevents `onResult`
  from being called on subsequent messages.
- Unit: `broadcastSend` and `broadcastListen` throw `"BroadcastChannel not supported"` when
  `BroadcastChannel` is deleted from global scope (mocked).

### What is NOT property-tested

- **Demo page UI** (Requirements 6.1–6.11): manual browser verification per the checklist
  below.
- **Field page UI** (Requirement 7.1–7.3, 7.5): manual browser verification. Field CSV
  round-trip and quoting (Properties 7–8) are unit-tested in `field.ts` by extracting
  `csvSerialize` / `deserializeRows` as pure functions testable in Node.
- **AudioWorklet processor correctness**: processor files cannot run in Node; verified by the
  manual acoustic round-trip test.
- **Signal-level meter rendering**: manual verification.

### Manual verification checklist (to be listed in tasks.md)

1. **AudioWorklet TX**: open `demo.html` on localhost, select Send + Acoustic, type text, click
   Send. Verify an audible FSK tone sequence plays from the speaker.
2. **AudioWorklet RX**: in a second tab, select Listen + Acoustic. Verify mic permission prompt
   appears, constraint report is displayed, and the signal-level meter responds to ambient sound.
3. **Two-tab acoustic round-trip**: with one tab in Send + Acoustic and another in
   Listen + Acoustic (on the same device, within ~0.5 m), send a message. Verify the decoded
   text appears in the Listen tab with elapsed time.
4. **Two-tab simulated round-trip**: with one tab in Send + Simulated and another in
   Listen + Simulated, set SNR to 20 dB and drift to 0. Verify decode succeeds. Set SNR to
   3 dB; verify decode either succeeds or shows a failure reason (never silent wrong output).
5. **HTTPS gate**: serve `demo.html` over HTTP on a non-localhost origin. Verify the UI shows
   `"requires-https"` without triggering a microphone permission prompt.
6. **Permission denied**: on localhost, click Listen + Acoustic and deny the microphone
   permission. Verify `"permission-denied"` is shown in the result area.

---

## Runtime Dependencies

No new runtime npm packages. All new functionality uses built-in browser and Node APIs:

| Concern | Implementation |
|---|---|
| AudioWorklet streaming (TX) | `AudioWorkletNode`, `AudioWorkletProcessor` (browser built-in) |
| Microphone capture (RX) | `navigator.mediaDevices.getUserMedia` (browser built-in) |
| Tab-to-tab messaging | `BroadcastChannel` (browser built-in; also available in Node 18+) |
| Ring buffer | `Float32Array` with two integer state variables |
| CSV export | `Blob` + `URL.createObjectURL` (browser built-in) |
| Local persistence | `localStorage` (browser built-in) |
| Fake timers in tests | `vi.useFakeTimers()` (Vitest built-in) |
| Property-based tests | `fast-check` (already a dev-dependency) |

Adding a runtime dependency requires a written rationale in this document; none is needed here.

# Requirements Document

## Introduction

This slice (handshake-audio-slice-2) adds real audio I/O and a browser-based demo
to the Handshake data-over-sound application. Slice-1 delivered the pure
modem/protocol/simulated-channel layers; this slice wires those layers to the browser's
Web Audio API and to a BroadcastChannel path that lets a single laptop run a two-tab demo.

The slice delivers six new units of work:

1. **Sample-rate-aware ModemConfig construction** — builds a correct `ModemConfig` from the
   browser's actual `AudioContext.sampleRate` without resampling.
2. **AudioWorklet Transmitter** (`src/channel/audio-tx.ts`) — plays a pre-computed
   `Float32Array` through an `AudioWorkletNode`.
3. **AudioWorklet Receiver** (`src/channel/audio-rx.ts`) — captures microphone samples,
   buffers them in a ring buffer, and polls `receive()` every 500 ms.
4. **Ring Buffer** (`src/channel/ring-buffer.ts`) — a fixed-capacity circular buffer of
   `Float32Array` samples, unit-testable in Node/Vitest with no Web Audio dependency.
5. **BroadcastChannel Path** (`src/channel/broadcast.ts`) — a simulated-channel demo path
   that passes modulated samples between browser tabs over `BroadcastChannel` with
   configurable noise.
6. **Two-Tab Demo Page** (`demo.html` / `src/ui/demo.ts`) — role selector (Send / Listen)
   and path selector (Acoustic / Simulated), live signal meter, and result display.
7. **Field-Measurement Page** (`field.html` / `src/ui/field.ts`) — a form for recording
   real device × environment transmission attempts, with CSV export and `localStorage`
   persistence.

All modem arithmetic reuses the existing `modulate`, `receive`, `simulateChannel`, and
`defaultConfig` exports from slice-1 without modification. No new runtime npm packages
are introduced.

---

## Glossary

- **AudioWorklet_Processor**: a class that extends `AudioWorkletProcessor` and runs on the
  browser's audio rendering thread inside an `AudioWorkletNode`.
- **AudioWorklet_Transmitter**: the module at `src/channel/audio-tx.ts` that queues a
  `Float32Array` and plays it through an `AudioWorkletNode`.
- **AudioWorklet_Receiver**: the module at `src/channel/audio-rx.ts` that captures
  microphone samples via `getUserMedia` and an `AudioWorkletNode`, buffers them in the
  Ring_Buffer, and periodically calls `receive()`.
- **Ring_Buffer**: the class at `src/channel/ring-buffer.ts` — a fixed-capacity circular
  buffer of `Float32Array` samples that overwrites the oldest data when full.
- **Broadcast_Channel_Path**: the module at `src/channel/broadcast.ts` that transmits
  modulated samples between browser tabs over the `BroadcastChannel` API with optional
  simulated impairments.
- **Demo_Page**: the two-tab demonstration page served from `demo.html` / `src/ui/demo.ts`.
- **Field_Page**: the field-measurement recording page served from `field.html` /
  `src/ui/field.ts`.
- **Acoustic_Path**: the Demo_Page mode in which audio is played through the device speaker
  and captured by the device microphone.
- **Simulated_Path**: the Demo_Page mode in which samples travel over `BroadcastChannel`
  with software-applied impairments from `simulateChannel()`.
- **DecodeResult**: the discriminated union `{ ok: true, payload: Uint8Array } | { ok: false, reason: FailureReason }` defined in slice-1 (`src/protocol/frame.ts`).
- **FailureReason**: the string union `"no_sync" | "bad_length" | "crc_mismatch"` defined
  in slice-1.
- **ModemConfig**: the configuration object from slice-1 (`src/modem/config.ts`) that holds
  `sampleRate`, `baudRate`, `markFrequency`, `spaceFrequency`, and the derived
  `samplesPerSymbol`.
- **ChannelOptions**: the options object accepted by `simulateChannel()` from slice-1
  (`src/channel/simulated.ts`), covering `snrDb`, `gainMin`, `gainMax`, `clockDriftPpm`,
  `rng`, `leadingSilenceSamples`, and `trailingSilenceSamples`.
- **blockSize**: the number of samples the Web Audio render quantum delivers to each
  `process()` call; typically 128 on most browsers.
- **Constraint_Report**: the structured object emitted by the AudioWorklet_Receiver that
  lists each of `echoCancellation`, `noiseSuppression`, and `autoGainControl` with the
  value requested and the value the browser actually applied.

---

## Requirements

### Requirement 1: Sample-Rate-Aware ModemConfig

**User Story:** As a developer, I want the system to derive a correct `ModemConfig` from the
browser's actual `AudioContext.sampleRate`, so that modulated samples are always at the
native sample rate and no resampling is ever needed.

#### Acceptance Criteria

1. WHEN an `AudioContext` is created, THE system SHALL construct a `ModemConfig` by calling
   `createConfig({ ...defaultConfig, sampleRate: audioContext.sampleRate })` (minus the derived
   `samplesPerSymbol`), using the actual `audioContext.sampleRate` rather than a hard-coded value.
   Baud rate and tone frequencies SHALL come from `defaultConfig`; no module in this slice SHALL
   repeat them as numeric literals (steering: one config object, no magic numbers).
2. WHERE the browser returns `audioContext.sampleRate === 44100`, THE system SHALL produce a
   `ModemConfig` with `samplesPerSymbol === 441`, which yields exactly 18 complete cycles of
   the 1800 Hz tone and exactly 24 complete cycles of the 2400 Hz tone per symbol.
3. WHERE the browser returns `audioContext.sampleRate === 48000`, THE system SHALL produce a
   `ModemConfig` with `samplesPerSymbol === 480`, which yields exactly 18 complete cycles of
   the 1800 Hz tone and exactly 24 complete cycles of the 2400 Hz tone per symbol.
4. IF the browser returns a `sampleRate` other than 44100 or 48000, THE system SHALL log a
   warning that names the actual value and states that fractional symbol cycles may occur, and
   SHALL proceed using the actual `sampleRate` without modification.
5. THE system SHALL NOT resample audio samples at any point; every `Float32Array` produced by
   `modulate()` or consumed by `receive()` SHALL be at the sample rate of the active
   `AudioContext`.

---

### Requirement 2: AudioWorklet Transmitter

**User Story:** As a developer, I want a transmitter that plays a pre-computed `Float32Array`
through an `AudioWorkletNode`, so that audio output uses the correct Web Audio API path and
never relies on the deprecated `ScriptProcessorNode`.

#### Acceptance Criteria

1. THE AudioWorklet_Transmitter SHALL expose a `play(samples: Float32Array, ctx: AudioContext): Promise<void>` function that loads the worklet processor, creates an `AudioWorkletNode`, streams the samples to the audio output, and resolves the returned `Promise` when all samples have been delivered.
2. THE AudioWorklet_Transmitter SHALL stream samples by copying exactly `blockSize` samples
   into each `process()` output channel per render quantum, advancing an internal write
   pointer, until the buffer is exhausted.
3. WHEN the AudioWorklet_Processor has delivered all samples from the buffer, THE
   AudioWorklet_Transmitter SHALL disconnect the node and resolve the `Promise` returned by
   `play()`.
4. THE AudioWorklet_Transmitter SHALL NOT use `ScriptProcessorNode` or any other deprecated
   Web Audio API.
5. IF `samples` is empty (length 0), THE AudioWorklet_Transmitter SHALL resolve the `Promise`
   immediately without creating or starting an `AudioWorkletNode`.
6. THE AudioWorklet_Processor SHALL return `false` from `process()` once the buffer is
   exhausted, signalling the Web Audio engine to release the node.

---

### Requirement 3: AudioWorklet Receiver

**User Story:** As a developer, I want a receiver that captures microphone samples through
an `AudioWorkletNode`, buffers them, and polls `receive()` at a fixed interval, so that
incoming acoustic frames are decoded without busy-waiting or blocking the main thread.

#### Acceptance Criteria

0. THE Demo_Page SHALL create or `resume()` the `AudioContext` inside the click handler that
   starts sending or listening; browsers keep a context created without a user gesture
   suspended and silent.
1. WHEN `start(ctx: AudioContext)` is called, THE AudioWorklet_Receiver SHALL request
   microphone access via `getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } })`.
2. AFTER obtaining the media stream, THE AudioWorklet_Receiver SHALL call
   `track.getSettings()` on the first audio track, compare each of `echoCancellation`,
   `noiseSuppression`, and `autoGainControl` to the requested values, and emit a
   `constraint-report` event carrying a `Constraint_Report` object that lists the requested
   and actual value for each constraint.
3. THE AudioWorklet_Receiver SHALL route microphone samples from the `AudioWorkletNode`'s
   `process()` callback to the Ring_Buffer using `SharedArrayBuffer` or `MessagePort`
   transfer.
4. THE Ring_Buffer used by the AudioWorklet_Receiver SHALL be sized to hold at least
   `Math.ceil(sampleRate × (149 × 8 / baudRate)) + sampleRate` samples, which is the maximum
   frame duration (149-byte frame: 4 preamble + 2 sync + 1 length + 140 payload + 2 CRC, about
   11.9 s at 100 baud) plus one additional second of audio at the
   actual `sampleRate`.
5. WHILE the AudioWorklet_Receiver is running, THE system SHALL call `receive()` on a
   snapshot of the ring buffer contents every 500 ms using `setInterval`.
6. WHEN `receive()` returns `{ ok: true, payload }`, THE AudioWorklet_Receiver SHALL emit
   a `payload` event with the decoded `Uint8Array`, then call `ring_buffer.clear()`.
7. WHEN `receive()` returns `{ ok: false }`, THE AudioWorklet_Receiver SHALL continue
   polling without clearing the Ring_Buffer.
8. IF `getUserMedia` rejects with a `NotAllowedError`, THE AudioWorklet_Receiver SHALL emit
   an `error` event with the human-readable message `"permission-denied"` and SHALL NOT
   retry automatically.
9. IF `window.isSecureContext` is false (which covers http on any host other than localhost /
   127.0.0.1), THE AudioWorklet_Receiver SHALL emit an `error` event with the message `"requires-https"` before calling
   `getUserMedia`.
10. WHEN `stop()` is called, THE AudioWorklet_Receiver SHALL clear the polling interval,
    disconnect the `AudioWorkletNode`, stop all tracks of the media stream, and cease emitting
    events.
11. THE AudioWorklet_Receiver SHALL expose the interface:
    `start(ctx: AudioContext): Promise<void>`,
    `stop(): void`, and a callback or event-emitter registration for the event types
    `payload`, `error`, and `constraint-report`.

---

### Requirement 4: Ring Buffer

**User Story:** As a developer, I want a pure TypeScript ring buffer that holds a fixed
number of `Float32Array` samples and overwrites the oldest data when full, so that the
receiver can buffer an unbounded stream of audio without unbounded memory growth.

#### Acceptance Criteria

1. THE Ring_Buffer SHALL be constructed with a fixed integer capacity (number of samples);
   attempting to construct it with a capacity ≤ 0 SHALL throw a `RangeError`.
2. WHEN `write(samples: Float32Array)` is called and the new samples fit within the remaining
   capacity, THE Ring_Buffer SHALL append all samples in order without overwriting any
   existing data.
3. WHEN `write(samples: Float32Array)` is called and the number of new samples exceeds the
   remaining capacity, THE Ring_Buffer SHALL overwrite the oldest samples first, so that
   after the write the buffer contains the most recent `capacity` samples.
4. THE Ring_Buffer SHALL expose `read(): Float32Array` that returns a copy of all currently
   buffered samples in chronological order (oldest first), without modifying the buffer.
5. THE Ring_Buffer SHALL expose `clear(): void` that resets the buffer so that `length`
   returns 0 immediately after the call.
6. THE Ring_Buffer SHALL expose `get length(): number` that returns the number of valid
   samples currently held in the buffer, in the range `[0, capacity]`.
7. THE Ring_Buffer SHALL be a plain TypeScript class with no import of any Web Audio API
   interface, so that it is fully exercisable under Vitest in a Node environment.

---

### Requirement 5: BroadcastChannel Path

**User Story:** As a developer, I want a BroadcastChannel-based sender and receiver so
that a judge can run the full two-tab demo on one laptop without a microphone, with
adjustable simulated noise.

#### Acceptance Criteria

1. THE Broadcast_Channel_Path SHALL use a `BroadcastChannel` instance named `"handshake"`
   for all inter-tab communication.
2. IN the sender role, WHEN `send(payload: Uint8Array, config: ModemConfig)` is called with the
   raw application payload (not a frame), THE Broadcast_Channel_Path SHALL call
   `modulate(encodeFrame(payload), config)` and post the resulting
   samples to the `BroadcastChannel` as a transferable `ArrayBuffer`.
3. IN the receiver role, WHEN a message is received on the `BroadcastChannel`, THE
   Broadcast_Channel_Path SHALL deserialize the `ArrayBuffer` back into a `Float32Array`,
   pass it through `simulateChannel(samples, options)` with the caller-supplied
   `ChannelOptions`, call `receive(impairedSamples, config)`, and invoke the `onResult`
   callback with the resulting `DecodeResult`.
4. THE Broadcast_Channel_Path SHALL expose:
   `send(payload: Uint8Array, config: ModemConfig): void` and
   `listen(options: ChannelOptions, config: ModemConfig, onResult: (r: DecodeResult) => void): () => void`,
   where the return value of `listen` is an unsubscribe function that removes the message
   listener and closes the `BroadcastChannel`.
5. IF the `BroadcastChannel` API is unavailable in the current browser, THE
   Broadcast_Channel_Path SHALL throw an `Error` with the message
   `"BroadcastChannel not supported"` when `send` or `listen` is first called.
6. THE Broadcast_Channel_Path SHALL frame exactly once: callers (including the Demo_Page) pass
   the raw UTF-8 payload to `send` and SHALL NOT call `encodeFrame` themselves. The posted
   message SHALL also carry `sentAt: Date.now()` (wall-clock time, comparable across tabs).

---

### Requirement 6: Two-Tab Demo Page

**User Story:** As a developer and judge, I want a two-tab demo page where one tab sends
and the other listens, so that the full Handshake pipeline can be demonstrated on a single
laptop with either real audio or a simulated channel.

#### Acceptance Criteria

1. THE Demo_Page SHALL present a role selector with options `"Send"` and `"Listen"`, and a
   path selector with options `"Acoustic"` and `"Simulated"`, both visible before any action
   is taken.
2. IN Send + Acoustic mode, WHEN the user submits a text message, THE Demo_Page SHALL encode
   the input as UTF-8, call `encodeFrame`, call `modulate` with the sample-rate-aware
   `ModemConfig`, and play the resulting samples through the AudioWorklet_Transmitter.
3. IN Listen + Acoustic mode, WHEN the user activates listening, THE Demo_Page SHALL call
   `AudioWorklet_Receiver.start()`, display the `Constraint_Report` values to the user, and
   update the result area on each `payload` or `error` event.
4. IN Send + Simulated mode, WHEN the user submits a text message, THE Demo_Page SHALL encode
   the input as UTF-8, call `encodeFrame`, and invoke `Broadcast_Channel_Path.send()`.
5. IN Listen + Simulated mode, THE Demo_Page SHALL call `Broadcast_Channel_Path.listen()`
   with options drawn from an SNR slider (range −25 to 40 dB, default 20 dB; slice-1 measured
   100% decode down to −10 dB and failures from −15 dB, so a slider that stops at 0 dB could never
   show a failure) and a clock-drift
   input (ppm, default 0), and SHALL update the result area on each decoded result.
6. WHILE the Demo_Page is in Listen + Acoustic mode, THE Demo_Page SHALL display a live
   signal-level meter showing the RMS of the most recent 1024 mic samples, updated at least
   every 100 ms and at most every 50 ms (throttled; render quanta arrive every ~3 ms).
7. WHEN a decode attempt completes, THE Demo_Page SHALL display timing that it can actually
   measure: on the Simulated path, `Date.now() − sentAt` from the BroadcastChannel message;
   on the Acoustic path, the sender shows the playback duration (frame bits ÷ baud) and the
   listener shows the decoded frame's duration. Times from `performance.now()` SHALL NOT be
   compared across tabs (each document has its own time origin).
8. WHEN `receive()` returns `{ ok: true, payload }`, THE Demo_Page SHALL display the decoded
   UTF-8 text and the label `"✓ decode succeeded"` in the result area.
9. WHEN `receive()` returns `{ ok: false, reason }`, THE Demo_Page SHALL display the failure
   reason (`"no_sync"`, `"bad_length"`, or `"crc_mismatch"`) and the label
   `"✗ decode failed"` in the result area.
10. THE Demo_Page SHALL work fully offline after the first page load; all pipeline code SHALL
    be bundled by Vite and no runtime network requests SHALL be made.
11. THE Demo_Page SHALL provide a text input, a live UTF-8 byte counter out of 140, and a
    submit button that is disabled when the byte count is 0 or exceeds 140.

---

### Requirement 7: Field-Measurement Page

**User Story:** As a developer and tester, I want a field-measurement page that lets me
record transmission attempts in a structured form and export the results as a CSV, so that
I can track real-world performance honestly without inventing data.

#### Acceptance Criteria

1. THE Field_Page SHALL provide a form with the following fields, in order:
   `date` (auto-filled with the current ISO date, editable), `tx_device` (text),
   `rx_device` (text), `environment` (text), `distance_m` (number), `payload_bytes` (number),
   `attempts` (positive integer), `successes` (non-negative integer ≤ `attempts`), and
   `notes` (text, optional).
2. WHEN the form is submitted, THE Field_Page SHALL validate that `successes ≤ attempts` and
   that all required fields are non-empty; IF validation fails, THE Field_Page SHALL display
   an inline error message and SHALL NOT append the row.
3. WHEN a valid row is submitted, THE Field_Page SHALL append the row to an in-memory CSV
   store and SHALL NOT auto-generate or invent any field value other than the auto-filled
   `date`.
4. THE Field_Page SHALL persist all recorded rows to `localStorage` using a fixed key; WHEN
   the page is reloaded, THE Field_Page SHALL restore all previously saved rows from
   `localStorage`.
5. THE Field_Page SHALL display all recorded rows in an HTML table with column headers
   matching the CSV column names: `date`, `tx_device`, `rx_device`, `environment`,
   `distance_m`, `payload_bytes`, `attempts`, `successes`, `notes`.
6. THE Field_Page SHALL offer a `"Download CSV"` button that, WHEN clicked, produces and
   downloads a `.csv` file containing a header row followed by all recorded rows, with values
   separated by commas and strings containing commas or newlines quoted per RFC 4180.
7. THE Field_Page SHALL NOT make any network requests at runtime; all data is stored locally.

---

### Requirement 8: Testability and Interface Isolation

**User Story:** As a developer, I want all non-Web-Audio units tested automatically and Web
Audio dependencies hidden behind injectable interfaces, so that the CI test suite never
requires a real audio context or microphone.

#### Acceptance Criteria

1. THE Ring_Buffer SHALL have Vitest unit tests that assert:
   (a) `read()` after a sequence of `write()` calls returns the written samples in
       chronological order;
   (b) WHEN total written samples exceed capacity, `read()` returns only the most recent
       `capacity` samples in order;
   (c) AFTER `clear()` is called, `length` equals 0 and `read()` returns an empty
       `Float32Array`.
2. THE polling loop of the AudioWorklet_Receiver SHALL be tested using `vi.useFakeTimers()`:
   given an AudioWorklet_Receiver whose Ring_Buffer is pre-populated with the samples of a
   valid encoded frame, the test SHALL advance fake time by 500 ms and assert that the
   `payload` callback is invoked exactly once with the correct decoded bytes.
3. THE Broadcast_Channel_Path SHALL be tested in Vitest (which provides a global
   `BroadcastChannel` in the Node environment): a test SHALL call `send()` in one listener
   context and assert that the `onResult` callback supplied to `listen()` is invoked with
   `{ ok: true, payload }` containing the original bytes, using `snrDb: Infinity` and
   `clockDriftPpm: 0`.
4. THE AudioWorklet_Transmitter and AudioWorklet_Receiver SHALL depend on `AudioContext` and
   `AudioWorkletNode` only through constructor-injected or factory-injected interfaces, so
   that unit tests can substitute stubs without patching globals.
5. THE tasks.md for this spec SHALL list the following manual verification steps, to be
   performed in a browser:
   (a) AudioWorklet TX: play a modulated frame and confirm audible tone sequence;
   (b) AudioWorklet RX: start the receiver, play a frame from another tab or device, and
       confirm successful decode;
   (c) Two-tab demo (Acoustic path): open two tabs, one in Send and one in Listen + Acoustic,
       and confirm end-to-end decode within 1 m;
   (d) Two-tab demo (Simulated path): open two tabs, set SNR to 10 dB, and confirm decode
       succeeds.

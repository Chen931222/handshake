# Implementation Plan: Handshake Modem Slice 1

## Overview

Implement the core data-over-sound pipeline in bottom-up layer order: project scaffold → modem
config → modulator → demodulator → protocol framing → receiver → simulated channel → noise
tests → dev page. Each task is independently runnable and testable. All code is pure TypeScript
with no runtime npm dependencies beyond the project dev-dependencies (Vite, TypeScript, Vitest,
fast-check).

## Tasks

- [x] 1. Project scaffold
  - [x] 1.1 Create package.json with TypeScript, Vite, Vitest, and fast-check as dev-dependencies; no runtime dependencies
    - Include scripts: `dev` (vite), `build` (vite build), `test` (vitest run), `preview` (vite preview)
    - _Requirements: 2.5, 3.4, 9.6_
  - [x] 1.2 Create tsconfig.json with strict mode, ESNext target, and bundler module resolution
    - Enable `strict`, `noUncheckedIndexedAccess`, `moduleResolution: "bundler"`, `target: "ESNext"`
    - _Requirements: (project foundation)_
  - [x] 1.3 Create vite.config.ts pointing at index.html as the entry point
    - _Requirements: 11.6_
  - [x] 1.4 Create vitest.config.ts with environment `node` (all code under test is pure; no jsdom dependency) and `testTimeout: 60000` (the noise tests run many ~12 s audio buffers)
    - _Requirements: 4.2, 7.2_
  - [x] 1.5 Create a minimal index.html stub with a `<script type="module" src="/src/main.ts">` tag
    - _Requirements: 11.1_
  - [x]* 1.6 Verify: run `npm install` to confirm it exits cleanly, then `npx vitest run` to confirm it exits with "no tests found"
    - _Requirements: (project foundation)_

- [x] 2. ModemConfig
  - [x] 2.1 Implement `src/modem/config.ts`: `ModemConfig` interface, `createConfig()`, and `defaultConfig` (48 000 Hz / 100 baud / mark 2 400 Hz / space 1 800 Hz)
    - `createConfig` derives `samplesPerSymbol` as `Math.round(sampleRate / baudRate)` and throws `RangeError` for `sampleRate ≤ 0`, `baudRate ≤ 0`, or `markFrequency === spaceFrequency`, naming the violated field
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5_
  - [x]* 2.2 Write unit tests in `test/modem.test.ts` for `createConfig` validation
    - Assert throws on `sampleRate ≤ 0`, `baudRate ≤ 0`, and `markFrequency === spaceFrequency`
    - Assert `samplesPerSymbol === Math.round(sampleRate / baudRate)` for valid inputs
    - _Requirements: 1.4, 1.5_
  - [x]* 2.3 Write property test for `createConfig` (Property 5 and Property 6)
    - **Property 5: Config rejects invalid parameters** — `fc.oneof` of invalid param combos; assert throws and names the bad field
    - **Property 6: Config derives samplesPerSymbol correctly** — `fc.integer` positive pairs; assert `samplesPerSymbol === Math.round(sampleRate / baudRate)`
    - **Validates: Requirements 1.4, 1.5**

- [x] 3. FSK Modulator
  - [x] 3.1 Implement `src/modem/modulator.ts`: `modulate(bytes, config): Float32Array` with continuous-phase FSK, MSB-first bit order
    - Phase accumulates across symbols without reset; sample value is `Math.sin(phase)`; throws `TypeError` on empty `bytes` or invalid config
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7_
  - [x]* 3.2 Write unit tests in `test/modem.test.ts` for modulator output length and sample range
    - Assert output length equals `bytes.length × 8 × samplesPerSymbol`
    - Assert every sample is in `[-1.0, 1.0]`
    - Assert MSB-first bit order: modulating `[0x80]` produces a first symbol at mark frequency (verify via Goertzel energy)
    - _Requirements: 2.1, 2.3, 2.4_
  - [x]* 3.3 Write property tests for modulator (Property 2 and Property 3)
    - **Property 2: Modulate output length** — `fc.uint8Array({ minLength: 1, maxLength: 140 })`; assert `output.length === bytes.length × 8 × samplesPerSymbol`
    - **Property 3: Modulate sample range** — same generator; assert every sample ∈ `[-1.0, 1.0]`
    - **Validates: Requirements 2.1, 2.4**

- [x] 4. FSK Demodulator
  - [x] 4.1 Implement `src/modem/demodulator.ts`: `demodulateBits(samples, config): Uint8Array` (raw 0/1 bits) and `demodulate(samples, config): Uint8Array` (packed bytes) using per-symbol Goertzel filter
    - Goertzel energy formula: `coeff = 2×cos(2π×f/sampleRate)`, iterate `s0 = x[n] + coeff×s1 − s2`, energy = `s1²+s2²−coeff×s1×s2`; bit = 1 iff `energyMark > energySpace`; bytes reconstructed MSB-first; throws `TypeError` on invalid config
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_
  - [x]* 4.2 Write unit tests in `test/modem.test.ts` for demodulator
    - Assert output length formula `Math.floor(samples.length / (8 × samplesPerSymbol))`
    - Assert empty return when `samples.length < 8 × samplesPerSymbol`
    - Assert single-tone Goertzel: pure mark-tone input → bit = 1
    - Assert `TypeError` on invalid config fields
    - _Requirements: 3.1, 3.5_
  - [x] 4.3 Write property test for modem round-trip (Property 1) and demodulate output length (Property 4)
    - **Property 1: Modem round-trip** — `fc.uint8Array({ minLength: 1, maxLength: 140 })`; assert `demodulate(modulate(input, config), config)` is byte-for-byte equal to `input`; `numRuns: 100`
    - **Property 4: Demodulate output length** — `fc.float32Array`; assert length equals `Math.floor(samples.length / (8 × samplesPerSymbol))`
    - **Validates: Requirements 4.1, 3.1, 3.6**

- [x] 5. Protocol framing
  - [x] 5.1 Implement `src/protocol/frame.ts`: `FailureReason` type, `DecodeResult` type, `encodeFrame(payload): Uint8Array`, and `decodeFrame(bytes): DecodeResult`
    - Frame layout: `[0xAA,0x55,0xAA,0x55][0x12,0x34][length][payload…][crc_hi][crc_lo]`; CRC-16/CCITT (poly 0x1021, init 0xFFFF, no reflection) over `[length, ...payload]`; `encodeFrame` throws `RangeError` on empty or >140-byte payload; `decodeFrame` never throws
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6_
  - [x]* 5.2 Write unit tests in `test/protocol.test.ts`
    - `no_sync` on random bytes without sync word; `no_sync` on input shorter than 10 bytes
    - `bad_length` on length byte = 0; `bad_length` on length byte = 141; `bad_length` on truncated frame
    - `crc_mismatch` on frame with one payload byte flipped
    - `RangeError` from `encodeFrame` on empty payload and on 141-byte payload
    - Known CRC regression: fixed payload → known CRC value
    - _Requirements: 5.5, 5.6, 6.2, 6.3, 6.4_
  - [x] 5.3 Write property tests in `test/protocol.test.ts` (Properties 7, 8, 9)
    - **Property 7: Frame structure invariant** — `fc.uint8Array({ minLength: 1, maxLength: 140 })`; assert preamble, sync word, length byte, payload bytes, and CRC bytes in correct positions
    - **Property 8: Protocol round-trip** — `fc.string()`; filter to UTF-8 byte length 1–140; assert `decodeFrame(encodeFrame(toBytes(s)))` returns `{ ok: true }` with payload equal to `toBytes(s)`; `numRuns: 100`
    - **Property 9: decodeFrame never throws** — `fc.uint8Array()` of arbitrary length; assert no exception for any input
    - **Validates: Requirements 5.1–5.4, 6.5, 6.6, 7.1**

- [x] 6. Receiver (frame acquisition)
  - [x] 6.1 Implement `src/modem/receiver.ts`: `receive(samples, config): DecodeResult` with 8-offset bit-granularity sync search
    - `offsets = [0..7].map(i => Math.round(i × samplesPerSymbol / 8))`; for each offset call `demodulateBits`; search for 24-bit pattern `[last preamble byte 0x55 + sync word 0x12,0x34]` in bit stream; for each match, pack bits from sync word onward into bytes, prepend fixed preamble, call `decodeFrame`; return first `ok: true`; return most-informative failure (`crc_mismatch > bad_length > no_sync`) if nothing succeeds; never throws
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5, 12.6_
  - [x] 6.2 Write unit tests in `test/receiver.test.ts` for the receiver (no dependency on the simulated channel, which is task 7)
    - Assert that `modulate(encodeFrame(payload))` with 137 zero samples prepended and 50 appended (not a multiple of `samplesPerSymbol`, and not a whole number of bits) is decoded by `receive` to the exact payload
    - Assert the same for leading padding of 0, 1, 240, 479, 480 and 1000 samples
    - Assert `receive(new Float32Array(0), config)` returns `{ ok: false, reason: "no_sync" }` without throwing
    - Assert `receive` on random float samples (no valid frame) returns `{ ok: false }` without throwing
    - _Requirements: 12.1, 12.4, 12.5_

- [x] 7. Simulated channel
  - [x] 7.1 Implement `src/channel/simulated.ts`: `simulateChannel(samples, options?): Float32Array` with gain jitter, clock-drift resampling, Box-Muller Gaussian noise, silence padding, and seedable `rng` option
    - Pipeline order: (1) gain from `rng()` ∈ `[gainMin, gainMax]`; (2) clock-drift linear-interpolation resampling at `r = 1 + clockDriftPpm×1e-6`, positions past end read as 0, length unchanged; (3) white Gaussian noise via Box-Muller at target SNR relative to original RMS (skip if `snrDb === Infinity` or original RMS = 0); (4) prepend `leadingSilenceSamples` zeros, append `trailingSilenceSamples` zeros
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.4a, 9.5, 9.6, 9.7_
  - [x] 7.2 Write unit tests and property test in `test/channel.test.ts`
    - Assert `simulateChannel(samples, { snrDb: Infinity, rng: seeded }).length === samples.length`
    - Assert `simulateChannel(samples, { clockDriftPpm: 0, snrDb: Infinity, rng: seeded })` samples match input within float epsilon
    - **Property 11: Channel output length invariant** — `fc.float32Array`; assert `simulateChannel(s, { leadingSilenceSamples: L, trailingSilenceSamples: T }).length === L + s.length + T`
    - **Validates: Requirements 9.1, 9.5**

- [x] 8. Checkpoint — ensure all unit and property tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 9. Noise-resistance and SNR sweep tests
  - [x] 9.1 Implement noise-resistance property test (Property 10) in `test/noise.test.ts`
    - `fc.assert(fc.property(fc.uint8Array({ minLength: 1, maxLength: 140 }), fc.constantFrom(Infinity, 30, 20, 10, 5, 0), fc.integer({ min: 0, max: 3 × samplesPerSymbol }), fc.float({ min: -200, max: 200 }), ...))` with `seed: 42`, `numRuns: 100`; assert result is either `{ ok: true }` with payload equal to original, or `{ ok: false }`; fail immediately if `ok: true` with wrong payload
    - **Property 10: Noise-resistance — no silent wrong accepts**
    - **Validates: Requirements 8.1, 8.2, 8.3, 8.4, 12.1**
  - [x] 9.2 Implement non-vacuity companion test (Req 8.4) in `test/noise.test.ts`
    - 100 cases at `snrDb: Infinity` with same random silence, gain, clockDriftPpm ranges; assert 100% return `{ ok: true }` with correct payload
    - _Requirements: 8.4_
  - [x] 9.3 Implement SNR sweep report test (Req 10) in `test/noise.test.ts`
    - `fc.sample` with fixed seed; 50 payloads × SNR levels {30, 20, 10, 5, 0} dB; count successes; `console.table` with columns `SNR (dB) | Attempts | Successes | Success Rate (%)`; assert each rate is a finite number ∈ [0, 100]
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5_

- [x] 10. Dev page
  - [x] 10.1 Implement `src/main.ts`: wire `TextEncoder` → `encodeFrame` → `modulate` → `simulateChannel` → `receive` on button click; compute UTF-8 byte count on every `input` event; display result, failure reason, SNR used, frame byte length, and simulated audio duration (frame bits ÷ baud)
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.6_
  - [x] 10.2 Implement `index.html`: text input, live UTF-8 counter (n/140), SNR `<select>` (Infinity/30/20/10/5/0, default 20), "Send (simulated)" `<button>` disabled when count = 0 or > 140, result display area; layout via plain flex/grid in a `<style>` tag; no external CSS framework
    - _Requirements: 11.1, 11.7_
  - [x]* 10.3 Manual smoke test (done 2026-11-12 in a browser: Chinese 66-byte message decoded at 20 dB; −20 dB shows "decode failed: no_sync"; no console errors): run `npm run dev`, open the page in a browser, type a message, select an SNR, click "Send (simulated)", and confirm the result area shows the correct decoded text and metadata
    - _Requirements: 11.2, 11.3, 11.4, 11.5_

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP. Property tests are not optional (steering: every encode/decode pair needs a round-trip property test).
- Kiro's integrated terminal fails to launch on this machine (node-pty conpty error), so `npm install` and `npx vitest run` may be run outside Kiro; report results back into the task.
- Each task references specific requirements for traceability; all 12 requirements are covered
- The design has a Correctness Properties section, so property-based tests (fast-check) are included throughout
- Property tests use `numRuns: 100` minimum; noise tests use `seed: 42` for reproducibility
- `decodeFrame` / `receive` never-throw guarantee (Prop 9, Req 6.5, 12.5) is critical — callers must not need try/catch on the hot path
- The dev page shows simulated audio duration because a 140-byte frame at 100 baud takes ~12 s — worth explaining to a reviewer

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "1.3", "1.4", "1.5"] },
    { "id": 1, "tasks": ["1.6", "2.1"] },
    { "id": 2, "tasks": ["2.2", "2.3", "3.1"] },
    { "id": 3, "tasks": ["3.2", "3.3", "4.1"] },
    { "id": 4, "tasks": ["4.2", "4.3", "5.1"] },
    { "id": 5, "tasks": ["5.2", "5.3", "6.1"] },
    { "id": 6, "tasks": ["6.2", "7.1"] },
    { "id": 7, "tasks": ["7.2", "9.1", "9.2", "9.3", "10.1", "10.2"] },
    { "id": 8, "tasks": ["10.3"] }
  ]
}
```

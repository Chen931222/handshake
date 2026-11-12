# Design Document

## Overview

This slice implements the core data-over-sound pipeline for Handshake as four independently
testable layers: **modem** (FSK modulator/demodulator), **protocol** (framing + CRC),
**channel** (simulated impairments), and a minimal **dev page** that wires them together in
the browser. A `receiver` module sits at the boundary of modem and protocol and handles
frame acquisition from an un-aligned sample stream.

All modem, protocol, and channel code is pure TypeScript with no Web Audio API dependency and
no runtime npm packages beyond the project dev-dependencies (Vite, TypeScript, Vitest,
fast-check).

---

## Architecture

### Module / file structure

```
src/
  modem/
    config.ts          ModemConfig interface, createConfig(), defaultConfig
    modulator.ts       modulate(bytes, config): Float32Array
    demodulator.ts     demodulateBits(samples, config): Uint8Array (0/1), demodulate = packBits(demodulateBits)
    receiver.ts        receive(samples, config): DecodeResult
  protocol/
    frame.ts           encodeFrame, decodeFrame, DecodeResult, FailureReason types
  channel/
    simulated.ts       simulateChannel(samples, options): Float32Array
  main.ts              dev-page entry point
index.html             dev page
test/
  modem.test.ts        Reqs 4 (modem round-trip), 2, 3 unit tests
  protocol.test.ts     Reqs 7 (protocol round-trip), 5, 6 unit tests
  noise.test.ts        Reqs 8 (noise-resistance), 10 (SNR sweep report)
```

### Layer dependency rules

```
modem ──────────────────► (nothing)
protocol ───────────────► (nothing)
channel/simulated ──────► modem (config types only, for sampleRate in drift resampling)
receiver ───────────────► modem/demodulator + protocol/frame
ui / main.ts ───────────► all layers
```

No layer may import from a layer above it. Web Audio API is used only in `src/channel/real.ts`
(out of scope for this slice).

---

## Data Flow

### Encode path (transmit)

```
string
  │  TextEncoder
  ▼
Uint8Array (UTF-8, 1–140 bytes)  ← payload
  │  encodeFrame()
  ▼
Uint8Array (frame: preamble + sync + length + payload + CRC)
  │  modulate()
  ▼
Float32Array (audio samples @ 48 kHz)
  │  simulateChannel()          ← optional, for testing
  ▼
Float32Array (impaired samples)
```

### Receive path (decode)

```
Float32Array (impaired samples, unknown leading offset)
  │  receive()
  │    ├─ for each of ≥8 timing offsets within one symbol period:
  │    │    demodulate() → Uint8Array
  │    │    decodeFrame() → DecodeResult
  │    │    if ok: true → return immediately
  │    └─ if no offset matches → { ok: false, reason: "no_sync" }
  ▼
DecodeResult
  ├─ { ok: true,  payload: Uint8Array }
  └─ { ok: false, reason: FailureReason }
```

---

## Components and Interfaces

### src/modem/config.ts

```typescript
export interface ModemConfig {
  readonly sampleRate: number;      // Hz, e.g. 48000
  readonly baudRate: number;        // symbols/s, e.g. 100
  readonly markFrequency: number;   // Hz for bit 1
  readonly spaceFrequency: number;  // Hz for bit 0
  readonly samplesPerSymbol: number; // Math.round(sampleRate / baudRate)
}

/**
 * Validates and constructs a ModemConfig.
 * Throws if sampleRate ≤ 0, baudRate ≤ 0, or markFrequency === spaceFrequency.
 */
export function createConfig(params: Omit<ModemConfig, "samplesPerSymbol">): ModemConfig;

/** Default: 48000 Hz / 100 baud / mark=2400 Hz / space=1800 Hz.
 *  Both tones are multiples of the baud rate, so each 10 ms symbol holds a whole number of
 *  cycles (24 and 18) and the two Goertzel bins are orthogonal. Both are inside 1.5–4 kHz. */
export const defaultConfig: ModemConfig;
```

`samplesPerSymbol` is computed once inside `createConfig` as
`Math.round(sampleRate / baudRate)` and stored; no other code recomputes or approximates it.

---

### src/modem/modulator.ts

```typescript
export function modulate(bytes: Uint8Array, config: ModemConfig): Float32Array;
```

**Algorithm**

- Output length: `bytes.length × 8 × config.samplesPerSymbol`.
- Bits are extracted MSB-first from each byte.
- Each bit maps to a continuous-phase sinusoidal tone: a `1` uses `markFrequency`, a `0` uses
  `spaceFrequency`.
- Phase state is a single `number` that accumulates as
  `phase += 2π × frequency / sampleRate` per sample and **never resets** between symbols
  or bytes. This prevents phase discontinuities that would create spurious energy at other
  frequencies.
- Sample value: `Math.sin(phase)`, always in `[-1.0, 1.0]`.
- Throws `TypeError` on empty `bytes` or invalid config (delegated to `createConfig` guard
  or an explicit check for the `samplesPerSymbol` / frequency constraints from Req 2.1).

---

### src/modem/demodulator.ts

```typescript
export function demodulate(samples: Float32Array, config: ModemConfig): Uint8Array;
```

**Algorithm — Goertzel filter per symbol**

For each symbol window of `samplesPerSymbol` samples:

```
Goertzel energy at frequency f over N samples:
  coeff = 2 × cos(2π × f / sampleRate)
  s1 = s2 = 0
  for each sample x[n]:
    s0 = x[n] + coeff × s1 - s2
    s2 = s1; s1 = s0
  energy = s1² + s2² - coeff × s1 × s2
```

Bit decision: if `energyMark > energySpace` → bit = 1, otherwise (including tie) → bit = 0.

Bytes are reconstructed MSB-first. Output length: `Math.floor(samples.length / (8 × samplesPerSymbol))`.
If `samples.length < 8 × samplesPerSymbol`, returns an empty `Uint8Array`.

Throws `TypeError` on invalid config (missing or non-finite `markFrequency`, `spaceFrequency`,
or non-integer `samplesPerSymbol < 1`).

---

### src/modem/receiver.ts

```typescript
export function receive(samples: Float32Array, config: ModemConfig): DecodeResult;
```

**Acquisition strategy (bit-level sync search)**

The receiver cannot assume that the first sample of `samples` is on a symbol boundary, nor that
the frame starts on a byte boundary of the demodulated stream (leading silence can be any
number of samples). It therefore works on bits, not bytes:

```
offsets = [0, 1, …, 7].map(i => Math.round(i × samplesPerSymbol / 8))
SYNC_BITS = bits of [0x55, 0x12, 0x34]   // last preamble byte + sync word, 24 bits
```

For each offset `o`:
1. `bits = demodulateBits(samples.subarray(o), config)` — one Goertzel pass, one bit per symbol
   (a `Uint8Array` of 0/1; `demodulate` is `packBits(demodulateBits(...))`).
2. Find every index `k` where `bits[k .. k+23]` equals `SYNC_BITS` (bit granularity).
3. For each match, the sync word starts at bit `k + 8`. Pack the bits from `k + 8` onward into
   bytes (`[0x12, 0x34, length, payload…, crc_hi, crc_lo]`), prepend the fixed preamble
   `[0xAA, 0x55, 0xAA, 0x55]`, and call `decodeFrame` on the result. Return immediately on
   `ok: true`.

If nothing succeeds, return the most informative failure seen across all offsets and matches,
in the order `crc_mismatch` > `bad_length` > `no_sync`.

Matching 24 bits instead of 16 cuts false sync hits in noise from about 1 in 65 536 bit positions
to about 1 in 16.7 million; with ~1,200 bit positions × 8 offsets per frame, false hits are rare
and are rejected by the CRC anyway.

Cost: 8 Goertzel passes over the buffer. For a 140-byte frame (149 bytes × 8 bits ÷ 100 baud
≈ 11.9 s ≈ 572,000 samples) that is about 8 × 2 × 572,000 ≈ 9 million multiply-adds.

The receiver never throws for any `Float32Array` input (including empty); all errors surface
as `DecodeResult` failures.

---

### src/protocol/frame.ts

```typescript
export type FailureReason = "no_sync" | "bad_length" | "crc_mismatch";
export type DecodeResult =
  | { ok: true;  payload: Uint8Array }
  | { ok: false; reason: FailureReason };

export function encodeFrame(payload: Uint8Array): Uint8Array;
export function decodeFrame(bytes: Uint8Array): DecodeResult;
```

**Frame layout** (minimum 10 bytes):

```
Offset  Length  Content
0       4       Preamble: [0xAA, 0x55, 0xAA, 0x55]
4       2       Sync word: [0x12, 0x34]
6       1       Length: payload byte count (1–140)
7       n       Payload bytes
7+n     2       CRC-16/CCITT: [crc_hi, crc_lo]
```

**encodeFrame** throws `RangeError` if `payload.length === 0` or `payload.length > 140`.

**decodeFrame** logic (never throws):
1. If `bytes.length < 10`, return `{ ok: false, reason: "no_sync" }`.
2. Search for first occurrence of `[0x12, 0x34]`. If not found, return `no_sync`.
3. Read length byte at `syncIndex + 2`. If `length === 0` or `length > 140`, return `bad_length`.
4. If `bytes.length < syncIndex + 3 + length + 2`, return `bad_length` (truncated).
5. Compute CRC-16/CCITT over `[length, payload[0], …, payload[n-1]]`. If mismatch, return `crc_mismatch`.
6. Return `{ ok: true, payload }`.

**CRC-16/CCITT algorithm**: polynomial `0x1021`, initial value `0xFFFF`, no input or output
reflection (also known as CRC-16/IBM-3740 / CRC-16/AUTOSAR). Implemented as a software
bit-by-bit loop or lookup table; no external library needed. The 2-byte result is appended
big-endian.

---

### src/channel/simulated.ts

```typescript
export interface ChannelOptions {
  snrDb?: number;                 // default Infinity (no noise)
  gainMin?: number;               // default 0.8
  gainMax?: number;               // default 1.2
  clockDriftPpm?: number;         // default 0, clamped to [-300, +300]
  rng?: () => number;             // default Math.random; tests pass a seeded generator
  leadingSilenceSamples?: number; // default 0
  trailingSilenceSamples?: number; // default 0
}

export function simulateChannel(
  samples: Float32Array,
  options?: ChannelOptions
): Float32Array;
```

**Pipeline** (applied in order to avoid order-dependent SNR measurement errors):

1. **Gain**: multiply every sample by `gain`, where `gain` is drawn uniformly from
   `[gainMin, gainMax]` using `rng()`.
2. **Clock drift**: resample by linear interpolation, `y[n] = x(n × r)` with
   `r = 1 + clockDriftPpm × 1e-6`; positions past the end read as 0, so length is unchanged.
   This shifts tones and stretches timing together, like a real speaker-to-mic link.
   At 200 ppm over 11.9 s the timing slips about 2.4 ms (a quarter of a symbol) — within what
   per-symbol Goertzel tolerates.
3. **Noise**: white Gaussian noise at target SNR relative to the **original** (pre-gain) signal
   RMS. Noise amplitude is `σ = rms(originalSamples) / 10^(snrDb / 20)`. Each noise sample
   is generated via the **Box-Muller transform**:
   ```
   u1 = 1 - rng(), u2 = rng()   (u1 in (0,1], avoids log(0))
   noise = σ × sqrt(-2 × ln(u1)) × cos(2π × u2)
   ```
   If `rms(originalSamples) === 0` or `snrDb === Infinity`, no noise is added.
4. **Silence padding**: prepend `leadingSilenceSamples` zeros, append `trailingSilenceSamples`
   zeros.

Output length: `leadingSilenceSamples + samples.length + trailingSilenceSamples`.

No Web Audio API is imported.

---

### index.html + src/main.ts (dev page)

```
┌─────────────────────────────────┐
│  Message  [________________]  n/140 bytes  │
│  SNR      [▼ 20 dB        ]                │
│           [Send (simulated)]               │
│                                            │
│  Result:  ✓ decode succeeded               │
│           decoded: "hello world"           │
│           SNR used: 20 dB                  │
│           Frame size: 24 bytes             │
└─────────────────────────────────┘
```

- UTF-8 byte count is recomputed on every `input` event using `TextEncoder`.
- "Send (simulated)" is `disabled` when count is 0 or > 140.
- On click: `TextEncoder` → `encodeFrame` → `modulate` → `simulateChannel` (leading silence
  = `Math.floor(Math.random() * 3 * config.samplesPerSymbol)`) → `receive`.
- Result area is updated synchronously (no async needed; computation is fast enough for 140
  bytes at 100 baud ≈ 11.9 s of audio ≈ 9 M multiply-adds in the receiver — well under a
  second in JS).
- The page also shows how long the transmission would take as real audio (frame bits ÷ baud),
  since a judge will ask why a 140-byte message takes about 12 seconds.
- No external CSS frameworks; layout via plain flex/grid in a `<style>` tag in `index.html`.
- No network requests after initial page load; all code is bundled by Vite.

---

## Data Models

```typescript
// All modem parameters live here; never scattered as literals elsewhere.
interface ModemConfig {
  sampleRate: number;
  baudRate: number;
  markFrequency: number;
  spaceFrequency: number;
  samplesPerSymbol: number;  // derived
}

// Protocol output / receiver output
type DecodeResult =
  | { ok: true;  payload: Uint8Array }
  | { ok: false; reason: "no_sync" | "bad_length" | "crc_mismatch" };
```

No persistent data storage. No network data models. All data flows through function arguments
and return values as typed value objects.

---

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions
of a system — essentially, a formal statement about what the system should do. Properties
serve as the bridge between human-readable specifications and machine-verifiable correctness
guarantees.*

### Property 1: Modem round-trip

*For any* `Uint8Array` of length 1–140 and the default `ModemConfig`,
`demodulate(modulate(input, config), config)` returns a `Uint8Array` whose length and every
byte are identical to `input`.

**Validates: Requirements 4.1, 3.6**

---

### Property 2: Modulate output length

*For any* non-empty `Uint8Array` of length 1–140 and a valid `ModemConfig`, the length of
`modulate(bytes, config)` equals exactly `bytes.length × 8 × config.samplesPerSymbol`.

**Validates: Requirements 2.1**

---

### Property 3: Modulate sample range

*For any* non-empty `Uint8Array` of length 1–140 and a valid `ModemConfig`, every sample in
the `Float32Array` returned by `modulate(bytes, config)` is in the closed interval `[-1.0, 1.0]`.

**Validates: Requirements 2.4**

---

### Property 4: Demodulate output length

*For any* `Float32Array` of arbitrary length and a valid `ModemConfig`, the length of
`demodulate(samples, config)` equals `Math.floor(samples.length / (8 × samplesPerSymbol))`.

**Validates: Requirements 3.1**

---

### Property 5: Config rejects invalid parameters

*For any* parameter set where at least one of `sampleRate ≤ 0`, `baudRate ≤ 0`, or
`markFrequency === spaceFrequency` holds, `createConfig(params)` throws an error identifying
the violated constraint.

**Validates: Requirements 1.5**

---

### Property 6: Config derives samplesPerSymbol correctly

*For any* valid `sampleRate` and `baudRate` (both positive), `createConfig(...)` produces a
config where `samplesPerSymbol === Math.round(sampleRate / baudRate)`.

**Validates: Requirements 1.4**

---

### Property 7: Frame structure invariant

*For any* `Uint8Array` payload of length 1–140, `encodeFrame(payload)` returns a `Uint8Array`
that starts with `[0xAA, 0x55, 0xAA, 0x55, 0x12, 0x34]`, has byte 6 equal to
`payload.length`, has bytes 7 through `6 + payload.length` equal to the payload, and has the
correct CRC-16/CCITT over `[length, ...payload]` in the final two bytes.

**Validates: Requirements 5.1, 5.2, 5.3, 5.4**

---

### Property 8: Protocol round-trip

*For any* Unicode string `s` whose UTF-8 encoding has byte length in 1–140,
`decodeFrame(encodeFrame(toBytes(s)))` returns `{ ok: true }` with a `payload` byte-for-byte
equal to `toBytes(s)`.

**Validates: Requirements 7.1, 6.6, 6.1**

---

### Property 9: decodeFrame never throws

*For any* `Uint8Array` of any length (including 0), `decodeFrame(bytes)` returns a
`DecodeResult` and does not throw.

**Validates: Requirements 6.5**

---

### Property 10: Noise-resistance — no silent wrong accepts

*For any* valid payload (1–140 bytes) and any noise configuration drawn from
`{ snrDb ∈ {Infinity, 30, 20, 10, 5, 0}, leadingSilence ∈ [0, 3×samplesPerSymbol], gain ∈ [0.8, 1.2], clockDriftPpm ∈ [-200, +200] }`,
if `receive(simulateChannel(modulate(encodeFrame(payload)), opts), config)` returns
`{ ok: true, payload: p }`, then `p` is byte-for-byte equal to the original payload.

Companion: at `snrDb = Infinity` with the same random silence/gain/offset ranges, 100% of at
least 100 generated cases must return `{ ok: true }` (non-vacuity guarantee).

**Validates: Requirements 8.1, 8.2, 8.4, 12.1**

---

### Property 11: Channel output length invariant

*For any* `Float32Array` and channel options with `leadingSilenceSamples = L` and
`trailingSilenceSamples = T`, `simulateChannel(samples, opts).length === L + samples.length + T`.

**Validates: Requirements 9.1, 9.5**

---

## Error Handling

| Situation | Location | Behavior |
|---|---|---|
| `sampleRate ≤ 0`, `baudRate ≤ 0`, `markFreq = spaceFreq` | `createConfig` | throws `RangeError` naming the bad field |
| `modulate` called with empty `Uint8Array` or invalid config | `modulate` | throws `TypeError` |
| `demodulate` called with invalid config | `demodulate` | throws `TypeError` naming the bad field |
| `encodeFrame` with empty or >140-byte payload | `encodeFrame` | throws `RangeError` |
| Any input to `decodeFrame` | `decodeFrame` | never throws; returns `DecodeResult` |
| Any input to `receive` | `receive` | never throws; returns `DecodeResult` |
| Microphone permission denied | (out of scope this slice) | — |

The `decodeFrame` / `receive` no-throw guarantee is critical: the receiver operates on
arbitrary sample buffers that may contain no valid frame, and callers must not need try/catch
around the hot path.

---

## Testing Strategy

### Framework

- **Vitest** for test runner.
- **fast-check** for property-based tests (already a dev-dependency per steering rules).
- Property tests: `numRuns: 100` minimum.
- Noise/sweep tests: `numRuns: 100` with a fixed seed (`seed: 42`) for reproducibility.

### Test files

**test/modem.test.ts**
- Property 1 (modem round-trip) — fast-check, `fc.uint8Array({ minLength: 1, maxLength: 140 })`
- Property 2 (modulate output length) — fast-check
- Property 3 (sample range) — fast-check
- Property 4 (demodulate output length) — fast-check
- Property 5 (config rejects invalid) — fast-check with `fc.oneof` of invalid param combos
- Property 6 (samplesPerSymbol derivation) — fast-check over positive integers
- Unit: MSB-first bit order (modulate `0x80`, check first symbol is mark-frequency tone via Goertzel)
- Unit: single-tone symbol Goertzel check (bit = 1 from pure mark-tone input)

**test/protocol.test.ts**
- Property 7 (frame structure) — fast-check, `fc.uint8Array({ minLength: 1, maxLength: 140 })`
- Property 8 (protocol round-trip) — fast-check, Unicode strings filtered to 1–140 UTF-8 bytes
- Property 9 (decodeFrame never throws) — fast-check, arbitrary `fc.uint8Array()`
- Unit: `no_sync` on random bytes without sync word
- Unit: `bad_length` on frame with length byte = 0
- Unit: `bad_length` on frame with length byte = 141
- Unit: `bad_length` on truncated frame
- Unit: `crc_mismatch` on frame with one payload byte flipped
- Unit: `RangeError` from `encodeFrame` on empty payload
- Unit: `RangeError` from `encodeFrame` on 141-byte payload
- Unit: known CRC value for a fixed payload (regression)

**test/noise.test.ts**
- Property 10 (noise-resistance) — fast-check, fixed seed 42, 100 runs, SNR drawn from `fc.constantFrom(Infinity, 30, 20, 10, 5, 0)`
- Property 10 companion (non-vacuity at `snrDb = Infinity`) — 100 cases, assert 100% `ok: true`
- Property 11 (channel output length) — fast-check
- SNR sweep report (Req 10): `sample()` with fixed seed, 50 payloads × 5 SNR levels, `console.table` output, assert each rate ∈ [0, 100]

### Tag format for property tests

Each fast-check property test file includes a comment on the `it`/`test` block:

```typescript
// Feature: handshake-modem-slice-1, Property 1: modem round-trip
it("modem round-trip", () => { … });
```

### What is NOT property-tested

- Dev page UI (Req 11): manual browser verification via Vite dev server.
- SNR sweep report table format (Req 10): covered by unit assertion that rates are finite and in `[0, 100]`; exact formatting is verified by reading console output.
- No-Web-Audio constraints: verified by grep/import analysis, not by runtime test.

### CRC-16 honest limit

CRC-16 cannot guarantee the absence of wrong accepts. A randomly corrupted frame passes the
CRC check with probability approximately 1/65 536 (~0.0015 %). The noise-resistance property
test (Property 10) samples the input space; it does not exhaustively prove the invariant. A
corrupted frame that happens to produce a valid CRC will not be caught by the CRC, but the
preamble + sync-word search also provides a small additional filter. This limitation is
inherent to 16-bit CRC and is documented here rather than hidden.

### Runtime dependencies

No new runtime npm packages are introduced. All functionality uses:

| Concern | Implementation |
|---|---|
| Sinusoidal tone generation | `Math.sin` |
| Goertzel energy | arithmetic in a tight loop |
| Box-Muller Gaussian noise | `Math.random`, `Math.sqrt`, `Math.log`, `Math.cos` |
| CRC-16/CCITT | software bit loop (< 30 lines) |
| UTF-8 encode/decode | `TextEncoder` / `TextDecoder` (built-in browser API) |

Adding a CRC or DSP library as a runtime dependency would require a written rationale in this
document; none is needed.

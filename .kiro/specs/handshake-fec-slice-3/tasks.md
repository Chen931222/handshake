# Implementation Plan: Handshake FEC Slice 3

## Overview

Implement a rate-1/2 convolutional FEC layer (K=7, G0=0o171, G1=0o133) with soft-decision Viterbi decoding, block interleaving, and a robust frame codec. Four files are touched: two new source files (`src/protocol/fec.ts`, `src/protocol/robust-frame.ts`), one additive change to an existing file (`src/modem/demodulator.ts`), and two new test files (`test/fec.test.ts`, `test/slice3.test.ts`). All existing exports and tests are left unchanged.

## Tasks

- [x] 1. Implement `src/protocol/fec.ts` — convolutional encoder
  - [x] 1.1 Create `src/protocol/fec.ts` and export `fecEncode(bits: Uint8Array): Uint8Array`
    - Maintain a 7-bit shift register `reg`; for each input bit (plus 6 appended zero tail bits) compute `p0 = popcount(reg & 0x79) & 1` and `p1 = popcount(reg & 0x5B) & 1`, emit `[p0, p1]`
    - Output length must be exactly `2 × (N + 6)` elements, all in {0, 1}
    - Edge case: N=0 → 12 zero bits
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5_

  - [x]* 1.2 Write unit tests for `fecEncode` in `test/fec.test.ts`
    - Known-vector: empty input → 12 zero bits
    - Known-vector: `[1]` → verify 14-bit output against pre-computed value for G0=0o171, G1=0o133
    - _Requirements: 1.5_

- [x] 2. Implement `fecDecode` and interleaver in `src/protocol/fec.ts`
  - [x] 2.1 Export `fecDecode(softBits: Float32Array): Uint8Array`
    - 64-state Viterbi trellis; initialise pathMetric[0]=0, rest=+Infinity
    - Branch metric: Euclidean distance between received soft pair and expected ±1 values
    - Survivor storage: flat `Uint8Array` of length `M × 64` with `decisions[t*64 + nextState]`
    - Traceback from state 0 at time M; `prevState = nextState` (see design §fecDecode); collect M bits in reverse, discard last 6 (tail), return first `M−6` as `Uint8Array`
    - Throw `RangeError("fecDecode: softBits length must be even")` for odd-length input
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6_

  - [x] 2.2 Export `interleave(bits: Uint8Array, cols: number): Uint8Array` and `deinterleave(bits: Uint8Array, cols: number): Uint8Array`
    - `interleave`: write row-by-row into a zero-padded matrix, read column-by-column; output length = `ceil(bits.length / cols) × cols`
    - `deinterleave`: inverse permutation (write column-by-column, read row-by-row); `bits.length` must already be a multiple of `cols`
    - `cols=1` must return a copy of the input unchanged
    - Supported cols: 1, 2, 4, 8, 16, 32
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

- [x] 3. Property tests for `fec.ts` in `test/fec.test.ts`
  - [x]* 3.1 Write property test: Property 1 — FEC encoder output length
    - Use fast-check to generate `Uint8Array` with elements in {0,1}, length 0–256
    - Assert `fecEncode(bits).length === 2 * (bits.length + 6)` for all inputs
    - **Property 1: FEC encoder output length**
    - **Validates: Requirements 1.2**

  - [x]* 3.2 Write property test: Property 2 — FEC encoder output is binary
    - Use fast-check; for all inputs, assert every element of `fecEncode(bits)` is 0 or 1
    - **Property 2: FEC encoder output is binary**
    - **Validates: Requirements 1.4**

  - [x]* 3.3 Write property test: Property 3 — FEC decoder output length
    - Generate `Float32Array` of even length `2M` where `M >= 6`; assert `fecDecode(softBits).length === M - 6`
    - **Property 3: FEC decoder output length**
    - **Validates: Requirements 2.2**

  - [x]* 3.4 Write property test: Property 4 — FEC round-trip on clean channel
    - Generate arbitrary bit arrays length 0–256; map encoded hard bits to soft values (`1 → 1.0`, `0 → −1.0`); assert `fecDecode(toSoft(fecEncode(bits)))` equals `bits`
    - Run ≥100 fast-check trials
    - **Property 4: FEC round-trip on clean channel**
    - **Validates: Requirements 2.1, 2.3, 8.1, 8.2, 8.3, 8.4**

  - [x]* 3.5 Write property test: Property 5 — Interleaver round-trip
    - Generate arbitrary bit arrays and `cols` from {1, 2, 4, 8, 16, 32}
    - Assert `deinterleave(interleave(bits, cols), cols)` equals `bits`
    - **Property 5: Interleaver round-trip**
    - **Validates: Requirements 3.1, 3.2, 3.3, 9.1, 9.2**

- [x] 4. Checkpoint — verify FEC layer before building on it
  - Ensure all tests in `test/fec.test.ts` pass and no existing test files are broken. Ask the user if any questions arise.

- [x] 5. Add `demodulateSoft` to `src/modem/demodulator.ts`
  - [x] 5.1 Append `export function demodulateSoft(samples: Float32Array, config: ModemConfig): Float32Array` to the existing file — additive only, no other lines changed
    - Reuse the existing private `goertzelEnergy` helper and the same frequency bins, window size, and symbol boundaries as `demodulateBits`
    - Return `eMark - eSpace` per symbol as a `Float32Array`; return `0.0` when energies are equal
    - All existing exports (`demodulateBits`, `packBits`, `demodulate`) must remain unchanged and their tests must still pass
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 7.2_

- [x] 6. Implement `src/protocol/robust-frame.ts`
  - [x] 6.1 Create the file and export `encodeRobustFrame(payload: Uint8Array): Uint8Array`
    - Build innerData = `[length(1) ║ payload ║ crc_hi ║ crc_lo]`; CRC covers `[length ║ payload]` via `crc16` from `./frame`
    - Pipeline: `unpackBits(innerData)` → `fecEncode` → `interleave(cols=16)` → `packBits` → prepend header `[0xAA, 0x55, 0xAA, 0x55, 0x12, 0x34, 0xFF]`
    - Throw `RangeError` for payload > 140 bytes; handle empty payload correctly
    - Import `crc16` and `DecodeResult` from `./frame` (read-only); import `fecEncode`, `interleave` from `./fec`
    - Local helpers (not exported): `unpackBits`, `packBits`, `deinterleaveSoft`
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 7.1_

  - [x] 6.2 Export `decodeRobustFrame(bytes: Uint8Array): DecodeResult` in the same file
    - Scan for sync `[0x12, 0x34]`; check mode byte `0xFF`; extract FEC blob
    - Convert hard bits to soft ±1; `deinterleaveSoft(soft, 16)`; `fecDecode`; `packBits`
    - Parse innerData: verify length field, verify CRC; return `{ok:true, payload}` or appropriate failure reason
    - Error table: no sync → `{ok:false, reason:"no_sync"}`; bad length → `{ok:false, reason:"bad_length"}`; CRC fail → `{ok:false, reason:"crc_mismatch"}`
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 7.1_

- [x] 7. Unit tests for robust frame in `test/slice3.test.ts`
  - [x] 7.1 Write deterministic unit tests for `encodeRobustFrame` / `decodeRobustFrame`
    - Zero-length payload round-trip → `{ok:true, payload: Uint8Array(0)}`
    - Preamble+sync+mode header bytes verified for a sample payload (`[0xAA,0x55,0xAA,0x55,0x12,0x34,0xFF]`)
    - `decodeRobustFrame` on bytes without mode byte `0xFF` → `{ok:false, reason:"no_sync"}`
    - `decodeRobustFrame` on a normal-mode frame → `{ok:false}` (mode byte ≠ 0xFF)
    - _Requirements: 5.2, 6.1, 6.3, 6.4_

- [x] 8. Property tests for robust frame in `test/slice3.test.ts`
  - [x]* 8.1 Write property test: Property 7 — header bytes for all payloads
    - Generate payloads 0–140 bytes; assert first 7 bytes of `encodeRobustFrame(payload)` are `[0xAA,0x55,0xAA,0x55,0x12,0x34,0xFF]`
    - **Property 7: Robust frame starts with correct header**
    - **Validates: Requirements 5.2, 5.3**

  - [x]* 8.2 Write property test: Property 8 — robust frame round-trip on clean channel
    - Generate payload byte arrays 0–64 bytes; assert `decodeRobustFrame(encodeRobustFrame(p))` returns `{ok:true, payload: p}`
    - Run ≥100 fast-check trials
    - **Property 8: Robust frame round-trip on clean channel**
    - **Validates: Requirements 5.1, 5.3, 5.4, 5.5, 6.1, 6.2, 6.5, 6.6, 10.1, 10.2**

  - [x]* 8.3 Write property test: Property 9 — no wrong accepts under noise (CRC safety)
    - Generate arbitrary payloads; apply random bit-flip noise at BERs of 5%, 10%, 20% to encoded frame bytes; assert that if `decodeRobustFrame` returns `{ok:true, payload: recovered}` then `recovered` exactly equals the original payload
    - Run ≥1000 fast-check trials per BER level
    - **Property 9: No wrong accepts under noise (CRC safety)**
    - **Validates: Requirements 6.3, 11.1, 11.2, 11.3, 11.4, 11.5**

- [x] 9. SNR sweep comparison test in `test/slice3.test.ts`
  - [x]* 9.1 Write Property 10 — FEC gain at 10% BER (SNR sweep)
    - Use `createConfig`/`defaultConfig` from `src/modem/config.ts`; normal mode at 100 baud, robust mode at 50 baud (equal air time via `createConfig({baudRate: 50, ...})`)
    - Use `modulate` from `src/modem/modulator.ts` and `simulateChannel` from `src/channel/simulated.ts` for AWGN noise
    - Apply BER levels 5%, 10%, 15%, 20%; run ≥100 trials per level
    - Assert robust mode success rate exceeds normal mode by ≥20 percentage points at 10% BER
    - No magic numbers — all modem parameters via `createConfig` or `defaultConfig`
    - **Property 10: FEC gain at 10% BER**
    - **Validates: Requirements 12.1, 12.2, 12.3, 12.4, 12.5, 12.6**

- [x] 10. Final checkpoint — full test suite
  - Ensure all tests in `test/fec.test.ts` and `test/slice3.test.ts` pass. Confirm that `test/channel.test.ts`, `test/modem.test.ts`, `test/protocol.test.ts`, and `test/receiver.test.ts` continue to pass unchanged. Ask the user if any questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP; the starred sub-tasks are property/unit tests
- The implementation order satisfies all dependencies: `fec.ts` (Tasks 1–2) must be complete before `robust-frame.ts` (Task 6); `demodulateSoft` (Task 5) is independent and can proceed in parallel with Tasks 1–3
- Task 9 (SNR sweep) depends on both `robust-frame.ts` (Task 6) and the ability to wire up `demodulateSoft` with `modulate`/`simulateChannel`; complete Tasks 5 and 6 first
- Do not modify `src/protocol/frame.ts`, `src/modem/modulator.ts`, `src/modem/receiver.ts`, `src/modem/config.ts`, or any existing test file
- `fast-check` is already a dev dependency (used by slice-1/2 tests); no new npm packages are needed

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "2.2"] },
    { "id": 1, "tasks": ["1.2", "2.1", "5.1"] },
    { "id": 2, "tasks": ["3.1", "3.2", "3.3", "3.4", "3.5"] },
    { "id": 3, "tasks": ["6.1"] },
    { "id": 4, "tasks": ["6.2"] },
    { "id": 5, "tasks": ["7.1", "8.1", "8.2", "8.3"] },
    { "id": 6, "tasks": ["9.1"] }
  ]
}
```

## Implementation notes (2026-11-13)

Kiro generated this spec, then the free tier's monthly credits ran out ("You've reached your monthly usage limit"). The tasks were implemented outside Kiro with another coding assistant, following this list. Files: `src/protocol/fec.ts`, `src/protocol/robust-frame.ts`, `src/modem/any-receiver.ts`, `demodulateSoft()` in `src/modem/demodulator.ts`, tests in `test/fec.test.ts` (13 tests; the whole suite is 107 and passes).

Deviations from requirements.md / design.md, each with its reason:

1. **Decoding works on soft values from audio, not on bytes.** Req 6 and the "hard decision" path decode `bytes`; that throws away the confidence that soft-decision Viterbi exists to use. `receiveRobust(samples, config)` finds the sync on hard bits and decodes the soft values after it.
2. **The length byte is coded on its own** (2 × (8 + 6) = 28 bits, not interleaved) and decoded first. With the length inside the interleaved block, the receiver cannot know how many soft values to take before it has decoded them. There is no separate mode byte; every listener simply tries normal, then robust (`receiveAny`), and each attempt must pass its own CRC.
3. **Failure reasons reuse the existing union** (`no_sync`, `bad_length`, `crc_mismatch`) instead of `BAD_CRC` / `BAD_LENGTH`; a checksum failure reports the decoded bytes as `corrupt`, as in slice 2.
4. **Empty payloads are rejected**, like `encodeFrame` (1–140 bytes), instead of Req 5.6's zero-length frame.
5. **Equal air time is robust at 100 baud vs normal at 50 baud.** Req 12.1 and the design pair robust at 50 with normal at 100; rate-1/2 coding at half the baud is four times the sound, not the same.
6. **Generators are stored bit-reversed** because the shift register keeps the newest bit in the lowest position; a test checks the impulse response is exactly 171/133, newest tap first.
7. **Soft values are normalized**: (mark − space) / (mark + space), so loud and quiet symbols weigh by how clearly they lean (Req 2.4 / 4.2 allowed raw differences).
8. **Added a tolerant sync search** (`maxSyncErrors`, 2 of 24 bits, both receivers). Not in the spec; found necessary by measurement: with exact sync, robust mode lost at equal air time because its uncoded header broke first.

Measured on the simulated channel, 100 trials per cell (same message):

| SNR (dB) | normal 100 baud (1× sound) | normal 50 baud (2×) | robust 100 baud (2×) |
|---|---|---|---|
| −15 | 17 | 87 | 100 |
| −16.5 | 1 | 58 | 97 |
| −18 | 0 | 11 | 62 |

Test-harness finding: the earlier tests seeded an LCG with consecutive integers, which gave correlated noise across trials; switching to mulberry32 changed slice 1's −15 dB result from 16/50 to 8/50 (README corrected).

**Not yet verified over the air.** The desktop speaker → USB mic link measured 2–9% raw bit errors (once 16–19%) and later delivered no tone at all (speaker muted or switched while the machine was in use), so the robust mode's real-air result is still unknown.

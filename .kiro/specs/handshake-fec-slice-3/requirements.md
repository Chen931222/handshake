# Requirements Document

## Introduction

Slice 3 adds forward error correction (FEC) to the Handshake audio modem to survive real-world over-the-air noise. Desktop speaker → USB mic tests at 100 baud yielded 16–19% bit error rate (BER), causing every frame to fail CRC. A rate-1/2 convolutional code (constraint length 7, generators 0o171/0o133) with soft-decision Viterbi decoding corrects scattered BERs up to ~10%. A block interleaver converts burst errors into scattered errors before Viterbi. A new soft demodulator output feeds per-symbol confidence values directly into the decoder. A "robust mode" frame variant encodes the payload through FEC+interleave while keeping the existing preamble/sync header uncoded so acquisition is unchanged. Normal mode frames remain bit-for-bit compatible.

## Glossary

- **FEC Encoder**: The component in `src/protocol/fec.ts` that encodes a bit sequence using a rate-1/2 convolutional code and appends six zero tail bits.
- **FEC Decoder**: The Viterbi-based component in `src/protocol/fec.ts` that recovers the original bits from soft-decision values.
- **Viterbi Decoder**: The maximum-likelihood trellis decoder used by the FEC Decoder.
- **Soft Bit**: A floating-point value representing per-symbol confidence: (mark energy − space energy). Positive values favour a 1-bit; negative values favour a 0-bit.
- **Hard Bit**: A binary value (0 or 1) derived by thresholding a soft bit at zero.
- **Block Interleaver**: The component in `src/protocol/fec.ts` that rearranges bits into a rectangular matrix (write row-by-row, read column-by-column) to scatter burst errors.
- **Soft Demodulator**: The `demodulateSoft` function added to `src/modem/demodulator.ts` that returns one soft bit per symbol.
- **Robust Frame**: A frame produced by `encodeRobustFrame` / decoded by `decodeRobustFrame` whose payload section is FEC-encoded and interleaved.
- **Normal Frame**: A frame produced and decoded by the existing slice-1 `encodeFrame` / `decodeFrame`; bit-for-bit format is unchanged.
- **Preamble**: The leading tone sequence used for clock recovery, present in both Normal and Robust frames.
- **Sync Word**: The two-byte marker `[0x12, 0x34]` that terminates the preamble and marks frame start, present and uncoded in both Normal and Robust frames.
- **CRC**: The cyclic redundancy check appended to every frame payload to detect residual errors after decoding.
- **ModemConfig**: The single config object from `src/modem/config.ts` that holds all modem parameters.
- **DecodeResult**: The discriminated union `{ ok: true, payload } | { ok: false, reason: FailureReason }` from `src/protocol/frame.ts`.
- **Air Time**: The duration of the audio signal produced by modulating a frame; determined by bit count ÷ baud rate.

## Requirements

### Requirement 1: FEC Encoder

**User Story:** As a protocol developer, I want a rate-1/2 convolutional encoder so that every payload bit is protected by a redundant parity bit before transmission.

#### Acceptance Criteria

1. THE FEC Encoder SHALL implement a rate-1/2 convolutional code with constraint length 7 using generator polynomials 0o171 and 0o133 (octal).
2. WHEN `fecEncode(bits)` is called with an input of N bits, THE FEC Encoder SHALL append 6 zero tail bits and return an output of exactly 2 × (N + 6) bits.
3. THE FEC Encoder SHALL produce each output pair `[p0, p1]` for each input bit `b` by computing `p0 = parity(shift_register & 0o171)` and `p1 = parity(shift_register & 0o133)` where the shift register is updated with `b` before computing parities.
4. THE FEC Encoder SHALL accept a `Uint8Array` of bits (each element 0 or 1) and return a `Uint8Array` of bits (each element 0 or 1).
5. WHEN `fecEncode` is called with an empty `Uint8Array`, THE FEC Encoder SHALL return a `Uint8Array` of exactly 12 bits (6 tail bits × 2 output bits each), all zero.

---

### Requirement 2: FEC Decoder (Soft-Decision Viterbi)

**User Story:** As a protocol developer, I want a soft-decision Viterbi decoder so that the modem can recover original bits even when individual bits carry noise-corrupted confidence values.

#### Acceptance Criteria

1. THE FEC Decoder SHALL implement the Viterbi algorithm over a trellis with 64 states (2^(7−1)) matching the constraint-length-7 convolutional code defined in Requirement 1.
2. WHEN `fecDecode(softBits)` is called with a `Float32Array` of length 2M, THE FEC Decoder SHALL return a `Uint8Array` of length (M − 6) recovered information bits, discarding the 6 tail bits.
3. THE FEC Decoder SHALL compute branch metrics using the Euclidean distance between each received soft bit and the expected ±1 hard value, so that larger-magnitude soft bits contribute more confidence to the path metric.
4. THE FEC Decoder SHALL accept raw (mark energy − space energy) differences as soft bit values without requiring normalisation to ±1.
5. WHEN the input soft bit sequence has length that is not a multiple of 2, THE FEC Decoder SHALL return a `DecodeResult` with `ok: false` and `reason: 'BAD_LENGTH'`.
6. THE FEC Decoder SHALL terminate the trellis by forcing the final state to 0 (consistent with the 6 zero tail bits appended by the FEC Encoder), enabling full traceback to the unique zero-state endpoint.

---

### Requirement 3: Block Interleaver

**User Story:** As a protocol developer, I want a block interleaver so that burst channel errors are spread into scattered single-bit errors that the Viterbi decoder can correct.

#### Acceptance Criteria

1. WHEN `interleave(bits, cols)` is called, THE Block Interleaver SHALL write bits into a matrix row-by-row and read them out column-by-column, returning the reordered `Uint8Array`.
2. WHEN `deinterleave(bits, cols)` is called, THE Block Interleaver SHALL write bits into a matrix column-by-column and read them out row-by-row, returning the reordered `Uint8Array`, which is the inverse of `interleave`.
3. WHEN the length of `bits` is not exactly divisible by `cols`, THE Block Interleaver SHALL pad with zero bits to the next multiple of `cols` for `interleave` and strip the padding in `deinterleave`.
4. THE Block Interleaver SHALL accept `cols` values of 1, 2, 4, 8, 16, and 32 without error.
5. WHEN `cols` is 1, THE Block Interleaver SHALL return a copy of the input bits unchanged (identity operation).

---

### Requirement 4: Soft Demodulator

**User Story:** As a modem developer, I want a soft-output demodulator so that per-symbol confidence values can feed directly into the Viterbi decoder instead of being threshold-quantised to hard bits.

#### Acceptance Criteria

1. THE Soft Demodulator SHALL export `demodulateSoft(samples: Float32Array, config: ModemConfig): Float32Array` from `src/modem/demodulator.ts`.
2. WHEN `demodulateSoft` is called, THE Soft Demodulator SHALL return one `Float32` value per demodulated symbol equal to (mark-band energy − space-band energy) computed over the same symbol window used by `demodulateBits`.
3. THE Soft Demodulator SHALL use the same frequency bins, window size, and symbol boundaries defined by `config` as the existing `demodulateBits` function.
4. THE Soft Demodulator SHALL leave all existing exports of `src/modem/demodulator.ts` (`demodulateBits`, `packBits`, `demodulate`) unchanged and passing their existing tests.
5. WHEN the mark-band energy equals the space-band energy for a symbol, THE Soft Demodulator SHALL return 0.0 for that symbol (indicating maximum uncertainty).

---

### Requirement 5: Robust Frame Encoding

**User Story:** As a protocol developer, I want a robust frame encoder so that payload data survives noisy channels where normal frames fail CRC.

#### Acceptance Criteria

1. THE Robust Frame Encoder SHALL export `encodeRobustFrame(payload: Uint8Array): Uint8Array` from `src/protocol/frame.ts` or `src/protocol/robust-frame.ts`.
2. WHEN `encodeRobustFrame(payload)` is called, THE Robust Frame Encoder SHALL produce a byte sequence whose leading bytes are the same preamble and sync word `[0x12, 0x34]` used by the existing `encodeFrame`, so that the existing `receive()` sync search can locate the frame without modification.
3. WHEN `encodeRobustFrame(payload)` is called, THE Robust Frame Encoder SHALL FEC-encode and interleave the section consisting of [length byte || payload bytes || CRC bytes] using `fecEncode` and `interleave` before appending it after the sync word.
4. THE Robust Frame Encoder SHALL use `cols = 16` as the interleaver column count for the robust mode data section.
5. THE Robust Frame Encoder SHALL produce output as a `Uint8Array` of bytes (packed bits, MSB-first within each byte) suitable for input to `modulate`.
6. WHEN `payload` is empty (length 0), THE Robust Frame Encoder SHALL still produce a valid robust frame containing a zero-length field, CRC, and FEC overhead.

---

### Requirement 6: Robust Frame Decoding

**User Story:** As a protocol developer, I want a robust frame decoder so that received audio can be turned back into the original payload bytes after FEC correction.

#### Acceptance Criteria

1. THE Robust Frame Decoder SHALL export `decodeRobustFrame(bytes: Uint8Array): DecodeResult` from the same module as `encodeRobustFrame`.
2. WHEN `decodeRobustFrame(bytes)` is called with a valid robust frame, THE Robust Frame Decoder SHALL deinterleave and Viterbi-decode the data section, then verify the CRC, and return `{ ok: true, payload }` if the CRC passes.
3. IF the CRC check fails after Viterbi decoding, THEN THE Robust Frame Decoder SHALL return `{ ok: false, reason: 'BAD_CRC' }`.
4. IF the decoded length field specifies a payload length inconsistent with the total byte count, THEN THE Robust Frame Decoder SHALL return `{ ok: false, reason: 'BAD_LENGTH' }`.
5. THE Robust Frame Decoder SHALL accept `bytes` produced by any call to `encodeRobustFrame` and correctly reconstruct the original payload on a clean (zero-noise) channel.
6. THE Robust Frame Decoder SHALL use the same `cols = 16` interleaver column count used by the encoder to deinterleave before Viterbi decoding.

---

### Requirement 7: Normal Mode Compatibility

**User Story:** As a protocol developer, I want the existing normal-mode frame format to remain unchanged so that devices running slice-1 firmware remain interoperable.

#### Acceptance Criteria

1. THE FEC Encoder, FEC Decoder, Block Interleaver, and Soft Demodulator SHALL be implemented without modifying the byte-level output of `encodeFrame`.
2. THE System SHALL leave `decodeFrame`, `encodeFrame`, `modulate`, `demodulate`, `demodulateBits`, `packBits`, `receive`, `ModemConfig`, `createConfig`, and `defaultConfig` with the same signatures and return values as defined in slice-1.
3. WHEN `decodeFrame` is called on a byte sequence produced by `encodeFrame`, THE System SHALL return the same `DecodeResult` as before this slice's changes.
4. THE System SHALL not alter any existing test in `test/channel.test.ts`, `test/modem.test.ts`, `test/protocol.test.ts`, or `test/receiver.test.ts`; all pre-existing tests SHALL continue to pass.

---

### Requirement 8: FEC Round-Trip Property

**User Story:** As a test engineer, I want a property-based round-trip test for the FEC encoder/decoder pair so that correctness is verified across arbitrary input sequences.

#### Acceptance Criteria

1. THE FEC Round-Trip Test SHALL use fast-check to generate arbitrary `Uint8Array` values whose elements are constrained to 0 or 1.
2. FOR ALL bit sequences `bits`, THE FEC Round-Trip Test SHALL verify that `fecDecode(toSoft(fecEncode(bits)))` equals `bits`, where `toSoft` maps each hard bit `b` to the soft value `b === 1 ? 1.0 : -1.0` (clean channel, no noise).
3. THE FEC Round-Trip Test SHALL be located in `test/fec.test.ts` and executed by Vitest.
4. THE FEC Round-Trip Test SHALL cover input lengths from 0 to 256 bits inclusive.

---

### Requirement 9: Interleaver Round-Trip Property

**User Story:** As a test engineer, I want a property-based round-trip test for the interleaver/deinterleaver pair so that no bits are lost or reordered incorrectly across arbitrary inputs.

#### Acceptance Criteria

1. THE Interleaver Round-Trip Test SHALL use fast-check to generate arbitrary bit arrays and arbitrary `cols` values from the set {1, 2, 4, 8, 16, 32}.
2. FOR ALL bit arrays `bits` and column counts `cols`, THE Interleaver Round-Trip Test SHALL verify that `deinterleave(interleave(bits, cols), cols)` returns an array equal to `bits`.
3. THE Interleaver Round-Trip Test SHALL be located in `test/fec.test.ts` and executed by Vitest.

---

### Requirement 10: Robust Frame Round-Trip Property

**User Story:** As a test engineer, I want a property-based round-trip test for robust frame encode/decode on a clean channel so that the full pipeline is verified for arbitrary payloads.

#### Acceptance Criteria

1. THE Robust Frame Round-Trip Test SHALL use fast-check to generate arbitrary payload byte arrays of length 0 to 64 bytes.
2. FOR ALL payloads `p`, THE Robust Frame Round-Trip Test SHALL verify that `decodeRobustFrame(encodeRobustFrame(p))` returns `{ ok: true, payload: p }`.
3. THE Robust Frame Round-Trip Test SHALL be located in `test/slice3.test.ts` and executed by Vitest.

---

### Requirement 11: Safety Property (No Wrong Accepts Through CRC)

**User Story:** As a test engineer, I want a property-based safety test that injects noise into robust frames so that the decoder never returns `ok: true` with a payload that differs from what was sent.

#### Acceptance Criteria

1. THE Safety Test SHALL use fast-check to generate arbitrary payloads and arbitrary noise patterns that flip a random subset of bits in the encoded frame.
2. WHEN `decodeRobustFrame` is called on a noise-corrupted robust frame, THE Safety Test SHALL verify that IF the returned result has `ok: true` THEN the returned payload exactly equals the original payload.
3. THE Safety Test SHALL treat any `ok: true` result with a different payload as a test failure (a wrong accept that passed CRC).
4. THE Safety Test SHALL be located in `test/slice3.test.ts` and executed by Vitest.
5. THE Safety Test SHALL apply noise at BERs of 5%, 10%, and 20% across at least 1000 fast-check trials per BER level.

---

### Requirement 12: SNR Sweep Comparison

**User Story:** As a protocol developer, I want a test that compares normal mode versus robust mode frame success rates at equal air time so that the FEC gain is quantified and regression-detectable.

#### Acceptance Criteria

1. THE SNR Sweep Test SHALL simulate transmitting a fixed payload using normal mode at 100 baud and robust mode at 50 baud so that both transmissions occupy the same number of audio samples (equal air time), accounting for the rate-1/2 FEC doubling the bit count.
2. THE SNR Sweep Test SHALL apply additive white Gaussian noise at BER levels of 5%, 10%, 15%, and 20% (measured on the raw modulated bits before FEC) using the simulated channel from `src/channel/simulated.ts`.
3. THE SNR Sweep Test SHALL record the frame decode success rate (fraction of `ok: true` results) for each mode at each BER level over at least 100 trials.
4. WHEN BER is 10%, THE SNR Sweep Test SHALL assert that the robust mode success rate exceeds the normal mode success rate by at least 20 percentage points.
5. THE SNR Sweep Test SHALL be located in `test/slice3.test.ts` and executed by Vitest.
6. THE SNR Sweep Test SHALL use `ModemConfig` via `createConfig` or `defaultConfig` for all modem parameters; no magic numbers SHALL appear in the test code.

# Requirements Document

## Introduction

This slice delivers the core data-over-sound pipeline for the Handshake browser application.
It covers three pure, independently testable layers:

1. **Modem** (`src/modem`): a binary FSK modulator and demodulator operating on `Float32Array`
   samples at 48 kHz with no Web Audio dependency.
2. **Protocol** (`src/protocol`): a framing layer that wraps a UTF-8 payload in a preamble,
   sync word, length byte, and CRC-16, exposing `encodeFrame` / `decodeFrame` with explicit
   result types.
3. **Simulated channel** (`src/channel/simulated.ts`): a test harness that pipes encoded samples
   through white noise, gain jitter, sample-clock drift, and leading/trailing silence.

A minimal browser dev page wires the three layers together so that the round-trip can be
verified interactively without a real microphone.

The slice produces all Vitest property-based tests (via fast-check) required by the project
steering rules, including a SNR sweep report.

---

## Glossary

- **Modem**: the module in `src/modem/` that converts between byte arrays and `Float32Array`
  audio samples using binary FSK. Contains no Web Audio API calls.
- **Modulator**: the sub-component of the Modem that encodes bytes into audio samples.
- **Demodulator**: the sub-component of the Modem that decodes audio samples back into bytes.
- **FSK (Frequency-Shift Keying)**: a modulation scheme where each logical bit (0 or 1) is
  represented by a distinct audio tone frequency.
- **Mark_Frequency**: the tone frequency representing a logical `1` bit.
- **Space_Frequency**: the tone frequency representing a logical `0` bit.
- **Symbol**: one baud period of audio carrying one bit of information.
- **Baud_Rate**: the number of symbols transmitted per second; default 100.
- **Sample_Rate**: the audio sample rate used throughout the system; fixed at 48 000 Hz.
- **Modem_Config**: the single configuration object that holds all modem parameters
  (Sample_Rate, Baud_Rate, Mark_Frequency, Space_Frequency). No other module may contain
  these values as literals.
- **Protocol**: the module in `src/protocol/` that packs and unpacks frames.
- **Frame**: the binary structure produced by `encodeFrame`:
  `[preamble][sync_word][length_byte][payload_bytes][crc_high][crc_low]`.
- **Preamble**: a fixed sequence of alternating bits that allows the Demodulator to establish
  bit-clock alignment before the sync word arrives.
- **Sync_Word**: a fixed 16-bit pattern that marks the boundary between the preamble and the
  frame header; must not appear in the preamble.
- **CRC-16**: a 16-bit cyclic redundancy check computed over the length byte and payload bytes,
  appended as two big-endian bytes at the end of the frame.
- **Payload**: a UTF-8 encoded string of at most 140 bytes that the user wants to transmit.
- **EncodeFrame**: the function that accepts a `Uint8Array` payload and returns a `Uint8Array`
  frame.
- **DecodeFrame**: the function that accepts a `Uint8Array` byte stream and returns either
  `{ ok: true, payload: Uint8Array }` or `{ ok: false, reason: FailureReason }`.
- **FailureReason**: one of `"no_sync"`, `"bad_length"`, `"crc_mismatch"`.
- **Receiver**: the function `receive(samples, config)` in `src/modem/` (or `src/channel/`) that
  finds where a frame starts inside an arbitrary sample stream (unknown leading silence, not
  aligned to a symbol boundary), recovers the frame bytes, and returns the `decodeFrame` result.
  This is the only entry point the pipeline uses to go from received samples to a payload.
- **Simulated_Channel**: the module at `src/channel/simulated.ts` that takes encoded samples,
  applies impairments, and returns the impaired `Float32Array` to the caller.
- **SNR (Signal-to-Noise Ratio)**: ratio of signal power to noise power, expressed in decibels.
- **Dev_Page**: the minimal HTML page at the project root (or `index.html`) that exercises the
  full encode → simulate → decode round-trip in a browser without a real microphone.

---

## Requirements

### Requirement 1: Modem Configuration Object

**User Story:** As a developer, I want all modem parameters in one place, so that I can tune
the modem without hunting for magic numbers scattered across files.

#### Acceptance Criteria

1. THE Modem_Config SHALL define the following fields and no others for modem operation:
   `sampleRate` (number, Hz), `baudRate` (number, symbols/s), `markFrequency` (number, Hz),
   `spaceFrequency` (number, Hz).
2. THE Modem_Config SHALL export a default configuration object with `sampleRate = 48000`,
   `baudRate = 100`, `markFrequency` in the range 1500–4000 Hz, and `spaceFrequency` in the
   range 1500–4000 Hz, with `markFrequency ≠ spaceFrequency`.
3. THE Modem SHALL read all frequency, baud, and sample-rate values exclusively from a
   Modem_Config instance; no other source file SHALL contain these values as numeric literals.
4. WHEN a Modem_Config is supplied with a `baudRate` greater than 0 and a `sampleRate` greater
   than 0, THE Modem_Config SHALL derive the samples-per-symbol count as
   `Math.round(sampleRate / baudRate)`, yielding an integer number of samples per symbol with
   no further rounding applied per symbol during modem operation.
5. IF a Modem_Config is supplied with `sampleRate ≤ 0`, `baudRate ≤ 0`, or
   `markFrequency = spaceFrequency`, THEN THE Modem_Config SHALL reject the configuration with
   an error indicating which field constraint was violated, and SHALL NOT produce a
   samples-per-symbol value.

---

### Requirement 2: FSK Modulator

**User Story:** As a developer, I want a pure function that converts a byte array into audio
samples, so that I can test encoding without touching Web Audio.

#### Acceptance Criteria

1. WHEN `modulate(bytes, config)` is called with a non-empty `Uint8Array` and a valid `Modem_Config` — where a valid `Modem_Config` is an object whose `sampleRate` is an integer in the range 8000–192000 Hz inclusive, `markFrequency` and `spaceFrequency` are positive numbers each less than `sampleRate / 2`, and `samplesPerSymbol` is an integer ≥ 1 — THE Modulator SHALL return a `Float32Array` whose length equals exactly `bytes.length × 8 × samplesPerSymbol`.
2. THE Modulator SHALL encode each bit as exactly one Symbol consisting of `samplesPerSymbol` samples of a sinusoidal tone: samples for a `1` bit use `markFrequency` and samples for a `0` bit use `spaceFrequency`, where each sample value is computed as `sin(phase)` with phase advancing by `2π × frequency / sampleRate` per sample and phase carrying over continuously from one Symbol to the next without resetting.
3. THE Modulator SHALL encode bits in most-significant-bit-first order within each byte.
4. THE Modulator SHALL produce sample values in the range `[-1.0, 1.0]` inclusive.
5. THE Modulator SHALL NOT import or reference any Web Audio API interface.
6. WHEN called with the same arguments, THE Modulator SHALL return a `Float32Array` containing identical values (pure, deterministic output).
7. IF `modulate` is called with an empty `Uint8Array` or a `Modem_Config` that does not satisfy the validity constraints defined in criterion 1, THEN THE Modulator SHALL throw an error indicating the invalid argument without returning a `Float32Array`.

---

### Requirement 3: FSK Demodulator

**User Story:** As a developer, I want a pure function that recovers bytes from audio samples,
so that I can verify decoding independently of the protocol layer.

#### Acceptance Criteria

1. WHEN `demodulate(samples, config)` is called with a `Float32Array` and a Modem_Config whose `markFrequency`, `spaceFrequency`, and `samplesPerSymbol` are each positive finite numbers and whose `samplesPerSymbol` is a positive integer ≥ 1, THE Demodulator SHALL return a `Uint8Array` of length `Math.floor(samples.length / (8 × samplesPerSymbol))`; if that length is 0 (i.e., `samples.length < 8 × samplesPerSymbol`), THE Demodulator SHALL return an empty `Uint8Array`.
2. THE Demodulator SHALL determine each bit by comparing the Goertzel energy at Mark_Frequency to the Goertzel energy at Space_Frequency over the Symbol window; if Mark energy is strictly greater than Space energy the bit SHALL be 1, otherwise (including an exact tie) the bit SHALL be 0.
3. THE Demodulator SHALL reconstruct bytes in most-significant-bit-first order, matching the Modulator's bit order.
4. THE Demodulator SHALL NOT import or reference any Web Audio API interface.
5. IF `config` is missing any of `markFrequency`, `spaceFrequency`, or `samplesPerSymbol`, or any of those fields is not a positive finite number, or `samplesPerSymbol` is not an integer ≥ 1, THEN THE Demodulator SHALL throw a `TypeError` with a message indicating which field is invalid, without modifying any external state.
6. WHEN given samples produced by the Modulator for a byte sequence `B` using the same Modem_Config with no noise added, THE Demodulator SHALL return a `Uint8Array` byte-for-byte equal to `B`.

---

### Requirement 4: Modem Round-Trip Property

**User Story:** As a developer, I want a property-based test confirming that any byte sequence
survives a clean encode–decode cycle, so that regressions are caught automatically.

#### Acceptance Criteria

1. THE property test SHALL assert that for all `Uint8Array` inputs of length 1–140 bytes and a fixed default `config`, `demodulate(modulate(input, config), config)` returns a `Uint8Array` whose length and every byte value are identical to `input`, where the output of `modulate` is passed directly to `demodulate` without any modification.
2. THE property test SHALL be implemented with fast-check and executed by Vitest.
3. THE property test SHALL cover at least 100 random inputs per run.

---

### Requirement 5: Protocol Frame Encoding

**User Story:** As a developer, I want an `encodeFrame` function that wraps a payload in a
well-defined binary frame, so that the Demodulator has the structure it needs to find and
verify data.

#### Acceptance Criteria

1. WHEN `encodeFrame(payload)` is called with a `Uint8Array` of 1–140 bytes, THE Protocol
   SHALL return a `Uint8Array` with the layout:
   `[preamble (4 bytes)][sync_word (2 bytes)][length (1 byte)][payload bytes][crc_high][crc_low]`.
2. THE Protocol SHALL compute CRC-16/CCITT (polynomial 0x1021, initial value 0xFFFF, no
   input/output reflection) over the concatenation of the length byte and the payload bytes,
   appending the result as two big-endian bytes.
3. THE Protocol SHALL use a Preamble of exactly 4 bytes in the alternating `0xAA`, `0x55`,
   `0xAA`, `0x55` pattern immediately before the Sync_Word.
4. THE Protocol SHALL use a fixed Sync_Word of `0x1234` (two bytes, big-endian) to mark the
   start of the frame header.
5. IF `encodeFrame` is called with a payload longer than 140 bytes, THEN THE Protocol SHALL
   throw a `RangeError` with a message indicating the payload exceeds the maximum length.
6. IF `encodeFrame` is called with an empty payload (0 bytes), THEN THE Protocol SHALL throw
   a `RangeError` with a message indicating the payload must not be empty.

---

### Requirement 6: Protocol Frame Decoding

**User Story:** As a developer, I want a `decodeFrame` function that extracts and verifies a
payload from a byte stream, so that transmission errors are caught before the payload reaches
the application.

#### Acceptance Criteria

1. WHEN `decodeFrame(bytes)` is called and the input contains the Sync_Word at the first
   occurrence, followed by a valid length byte (1–140), the declared number of payload bytes,
   and a matching CRC-16/CCITT, THE Protocol SHALL return `{ ok: true, payload: Uint8Array }`
   containing exactly the original payload bytes.
2. IF the Sync_Word `0x1234` is not found in the input, or the input is shorter than 10 bytes
   (the minimum frame size of 4 preamble + 2 sync + 1 length + 1 payload + 2 CRC = 10 bytes), THEN THE
   Protocol SHALL return `{ ok: false, reason: "no_sync" }`.
2a. IF the input ends before the declared payload bytes and both CRC bytes have arrived (truncated
   frame), THEN THE Protocol SHALL return `{ ok: false, reason: "bad_length" }`.
3. IF the length byte exceeds 140 or is 0, THEN THE Protocol SHALL return
   `{ ok: false, reason: "bad_length" }`.
4. IF the CRC-16/CCITT computed over the length byte and payload does not match the two
   appended CRC bytes, THEN THE Protocol SHALL return
   `{ ok: false, reason: "crc_mismatch" }`.
5. THE Protocol SHALL NOT throw an exception for any `Uint8Array` input; all error conditions
   SHALL be represented as `{ ok: false, reason: FailureReason }` return values.
6. WHEN `decodeFrame(encodeFrame(payload))` is called for any valid payload, THE Protocol
   SHALL return `{ ok: true, payload }` with a payload byte-for-byte equal to the input
   (round-trip invariant).

---

### Requirement 7: Protocol Round-Trip Property

**User Story:** As a developer, I want a property-based test confirming that any UTF-8 string
up to 140 bytes survives a full encode–decode cycle, so that the framing and CRC logic are
verified against arbitrary inputs.

#### Acceptance Criteria

1. THE property test SHALL assert, for each generated input string `s`, that `decodeFrame(encodeFrame(toBytes(s)))` returns an object where `ok` is `true` and `payload` is a byte array equal to `toBytes(s)` element-by-element.
2. THE property test SHALL be implemented with fast-check and executed by Vitest.
3. THE property test SHALL run with `numRuns` configured to at least 100, covering at least 100 distinct random strings per test execution.
4. THE property test SHALL generate strings by producing arbitrary Unicode strings and filtering to those whose UTF-8 encoded byte length is in the range 1–140 inclusive, discarding strings outside that range.

---

### Requirement 8: Protocol Noise-Resistance Property

**User Story:** As a developer, I want a property-based test confirming that the decoder never
silently returns wrong data under noise, so that corrupted frames always surface as explicit
failures.

#### Acceptance Criteria

1. FOR ALL payloads of 1–140 bytes and FOR ALL `snrDb` values drawn from the set {Infinity, 30, 20, 10, 5, 0} dB, WITH `leadingSilenceSamples` drawn at random from 0 to `3 × samplesPerSymbol` (so it is usually NOT a multiple of `samplesPerSymbol`), `trailingSilenceSamples` from 0 to `samplesPerSymbol`, gain from the default range, and `clockDriftPpm` from −200 to +200, WHEN samples produced by `modulate(encodeFrame(payload), config)` are passed through `simulateChannel` and then decoded via `receive` (Requirement 12), THE Protocol SHALL return either `{ ok: true, payload }` with the payload byte-for-byte equal to the original, or `{ ok: false, reason: FailureReason }`.
2. IF `decodeFrame` returns `{ ok: true, payload }` and the returned payload differs from the original payload byte-for-byte, THEN THE Protocol SHALL be considered to have violated the noise-resistance invariant and the test SHALL fail immediately.
3. THE property test SHALL be implemented with fast-check and Vitest, covering at least 100 distinct payload × noise combinations per run, with fast-check configured to a fixed seed for reproducibility.
4. To keep the property from passing vacuously (a decoder that always fails would satisfy criterion 1), a companion test SHALL assert that at `snrDb = Infinity`, with the same random silence, gain, and clock drift as criterion 1, `receive` returns `{ ok: true }` with the exact payload for 100% of at least 100 generated cases.
5. Honest limit, to be stated in design.md: CRC-16 cannot make a wrong accept impossible; a randomly corrupted frame passes the CRC with probability about 1 in 65,536. The test checks that this does not happen in the sampled runs; it does not prove it never happens.

---

### Requirement 9: Simulated Channel

**User Story:** As a developer, I want a simulated channel function that adds realistic
impairments to audio samples, so that I can test the modem and protocol under controlled
degradation without a real microphone.

#### Acceptance Criteria

1. WHEN `simulateChannel(samples, options)` is called, THE Simulated_Channel SHALL return a
   `Float32Array` of length exactly equal to `leadingSilenceSamples + samples.length + trailingSilenceSamples`.
2. THE Simulated_Channel SHALL add white Gaussian noise at the SNR specified in `options.snrDb`,
   where noise power is scaled such that `10 * log10(signalPower / noisePower) === options.snrDb` and signal power is the mean-square of the input `samples`; IF the RMS of `samples` is 0, THEN THE Simulated_Channel SHALL add no noise.
3. THE Simulated_Channel SHALL apply a gain multiplier drawn uniformly at random from
   `[options.gainMin, options.gainMax]` to the signal before adding noise; IF `options.gainMin`
   and `options.gainMax` are not provided, THEN THE Simulated_Channel SHALL default to the
   range `[0.8, 1.2]`.
4. THE Simulated_Channel SHALL model the sample-clock mismatch between two devices with
   `options.clockDriftPpm` (default 0), clamped to −300 to +300 ppm: the processed signal is
   resampled by linear interpolation at positions `n × (1 + clockDriftPpm × 1e-6)`, which shifts
   every tone frequency and stretches timing by the same ratio, as a real speaker-to-mic link
   does. The resampled signal keeps the input length; positions past the end read as 0.
   (This replaces an earlier "frequency offset" impairment: a fixed Hz shift with no timing
   change does not happen between phones, and multiplying by a cosine is amplitude
   modulation, not a shift.)
4a. THE Simulated_Channel SHALL take an optional `options.rng: () => number` (default
   `Math.random`) and use it for every random draw (gain and noise), so tests can be
   reproduced from a seed.
5. THE Simulated_Channel SHALL prepend exactly `options.leadingSilenceSamples` (default 0)
   zero-valued samples and append exactly `options.trailingSilenceSamples` (default 0)
   zero-valued samples to the processed signal.
6. THE Simulated_Channel SHALL NOT import or reference any Web Audio API interface.
7. WHEN `options.snrDb` is `Infinity`, THE Simulated_Channel SHALL return the signal with only
   gain and silence padding applied, with no noise samples added.

---

### Requirement 10: SNR Sweep Report Test

**User Story:** As a developer, I want a test that prints success rate versus SNR for a range
of noise levels, so that I can track modem performance regressions at a glance.

#### Acceptance Criteria

1. THE report test SHALL evaluate the full pipeline (`encodeFrame` → `modulate` →
   `simulateChannel` → `receive`), using the same random silence, gain, and clock-drift
   ranges as Requirement 8, for each of the SNR levels
   30, 20, 10, 5, and 0 dB; a trial is counted as a success if and only if `decodeFrame`
   returns `{ ok: true }` with a payload byte-for-byte equal to the original.
2. THE report test SHALL use 50 randomly generated UTF-8 payloads of 1–140 bytes each per SNR
   level, generated with fast-check's `sample` function using a fixed seed for reproducibility.
3. THE report test SHALL log a table to the console in the format:
   `SNR (dB) | Attempts | Successes | Success Rate (%)` for each SNR level, with
   `Success Rate (%)` rounded to one decimal place.
4. THE report test SHALL be a standard Vitest test; it SHALL NOT assert a specific minimum
   pass rate, but SHALL assert that each SNR level's computed success rate is a finite number
   in the range [0, 100] inclusive.
5. THE report test SHALL NOT make any network requests or file system writes beyond console
   output.

---

### Requirement 11: Minimal Dev Page

**User Story:** As a developer, I want a minimal browser page that runs the simulated
round-trip end-to-end, so that I can verify the full pipeline in a real browser without
connecting a microphone.

#### Acceptance Criteria

1. THE Dev_Page SHALL provide a text input, a live counter of the input's UTF-8 byte length out
   of 140 (one Chinese character is 3 bytes, so 140 characters can exceed the limit), an SNR
   selector (Infinity, 30, 20, 10, 5, 0 dB; default 20), and a "Send (simulated)" button that is
   disabled while the input is empty or over 140 bytes.
2. WHEN the "Send (simulated)" button is clicked, THE Dev_Page SHALL execute the pipeline:
   encode the input as UTF-8 → `encodeFrame` → `modulate` → `simulateChannel` (with a random
   leading silence as in Requirement 8) → `receive`, using default Modem_Config and the selected
   `snrDb`.
3. WHEN `decodeFrame` returns `{ ok: true }`, THE Dev_Page SHALL display the decoded text and
   the label "✓ decode succeeded".
4. WHEN `decodeFrame` returns `{ ok: false }`, THE Dev_Page SHALL display the failure reason
   and the label "✗ decode failed".
5. WHEN the pipeline completes, THE Dev_Page SHALL display the `snrDb` value used and the
   byte length of the encoded frame produced by `encodeFrame`.
6. THE Dev_Page SHALL NOT require a network connection after the initial page load; all
   pipeline code SHALL be bundled by Vite.
7. THE Dev_Page SHALL NOT apply decorative CSS beyond layout and legibility; no external CSS
   frameworks or stylesheets SHALL be loaded.

---

### Requirement 12: Frame Acquisition (Receiver)

**User Story:** As a developer, I want the receiver to find a frame anywhere in a stream of
samples, so that real recordings (which never start exactly on a symbol boundary) can be decoded.

#### Acceptance Criteria

1. WHEN `receive(samples, config)` is called with a `Float32Array` that contains one modulated
   frame preceded by any number of leading samples (silence or noise, not necessarily a multiple
   of `samplesPerSymbol`), THE Receiver SHALL search symbol-timing offsets and bit positions for
   the preamble + Sync_Word bit pattern, demodulate the frame bytes from the best-aligned
   position, and return the result of `decodeFrame` on those bytes.
2. THE Receiver SHALL search the Sync_Word at bit granularity, not only at byte boundaries.
3. THE Receiver SHALL try at least 8 evenly spaced timing offsets within one symbol period and
   SHALL NOT require more than one full-buffer demodulation pass per offset.
4. IF no offset yields the Sync_Word, THEN THE Receiver SHALL return
   `{ ok: false, reason: "no_sync" }`.
5. THE Receiver SHALL NOT throw for any `Float32Array` input, including an empty one.
6. THE Receiver SHALL NOT import or reference any Web Audio API interface.

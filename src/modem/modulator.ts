/**
 * src/modem/modulator.ts
 * FSK modulator: bytes → Float32Array audio samples.
 * Requirements: 2.1–2.7
 */

import { type ModemConfig } from "./config.js";

/**
 * Encodes `bytes` as continuous-phase binary FSK at the parameters in `config`.
 *
 * - Output length: bytes.length × 8 × samplesPerSymbol.
 * - Bit order: MSB-first within each byte.
 * - Tone: mark (bit 1) = markFrequency, space (bit 0) = spaceFrequency.
 * - Phase accumulates across the entire frame without resetting, preventing
 *   inter-symbol phase discontinuities.
 * - Every sample is Math.sin(phase) ∈ [-1.0, 1.0].
 *
 * Throws TypeError on empty bytes.
 * Throws RangeError on invalid config (delegated to the values already set).
 */
export function modulate(bytes: Uint8Array, config: ModemConfig): Float32Array {
  if (bytes.length === 0) {
    throw new TypeError("modulate: bytes must not be empty");
  }

  const { sampleRate, markFrequency, spaceFrequency, samplesPerSymbol } =
    config;

  if (
    !Number.isFinite(markFrequency) ||
    !Number.isFinite(spaceFrequency) ||
    !Number.isInteger(samplesPerSymbol) ||
    samplesPerSymbol < 1
  ) {
    throw new TypeError(
      "modulate: invalid config — markFrequency, spaceFrequency must be finite and samplesPerSymbol must be an integer ≥ 1",
    );
  }

  const totalSamples = bytes.length * 8 * samplesPerSymbol;
  const out = new Float32Array(totalSamples);

  const twoPiOverSr = (2 * Math.PI) / sampleRate;
  let phase = 0;
  let idx = 0;

  for (let b = 0; b < bytes.length; b++) {
    const byte = bytes[b]!;
    for (let bit = 7; bit >= 0; bit--) {
      // MSB-first: bit 7 of byte[0] is the first transmitted bit
      const isOne = (byte >>> bit) & 1;
      const freq = isOne ? markFrequency : spaceFrequency;
      const phaseStep = twoPiOverSr * freq;

      for (let s = 0; s < samplesPerSymbol; s++) {
        out[idx++] = Math.sin(phase);
        phase += phaseStep;
      }
    }
  }

  return out;
}

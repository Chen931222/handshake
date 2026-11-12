/**
 * src/modem/demodulator.ts
 * FSK demodulator: Float32Array audio samples → bytes.
 * Uses a per-symbol Goertzel filter to measure energy at mark and space frequencies.
 * Requirements: 3.1–3.6
 */

import { type ModemConfig } from "./config.js";

/**
 * Validates the config fields needed by the demodulator.
 * Throws TypeError naming the first invalid field found.
 */
function validateConfig(config: ModemConfig): void {
  if (!Number.isFinite(config.markFrequency) || config.markFrequency <= 0) {
    throw new TypeError(
      `demodulate: markFrequency must be a positive finite number, got ${config.markFrequency}`,
    );
  }
  if (!Number.isFinite(config.spaceFrequency) || config.spaceFrequency <= 0) {
    throw new TypeError(
      `demodulate: spaceFrequency must be a positive finite number, got ${config.spaceFrequency}`,
    );
  }
  if (!Number.isInteger(config.samplesPerSymbol) || config.samplesPerSymbol < 1) {
    throw new TypeError(
      `demodulate: samplesPerSymbol must be an integer ≥ 1, got ${config.samplesPerSymbol}`,
    );
  }
}

/**
 * Computes the Goertzel energy for frequency `f` over `samples[offset .. offset+N]`.
 *
 * Recurrence:
 *   coeff = 2 * cos(2π * f / sampleRate)
 *   s0 = x[n] + coeff * s1 - s2;  s2 = s1;  s1 = s0
 * Energy = s1² + s2² - coeff * s1 * s2
 */
function goertzelEnergy(
  samples: Float32Array,
  offset: number,
  N: number,
  freq: number,
  sampleRate: number,
): number {
  const coeff = 2 * Math.cos((2 * Math.PI * freq) / sampleRate);
  let s1 = 0;
  let s2 = 0;
  const end = offset + N;
  for (let i = offset; i < end; i++) {
    const s0 = (samples[i] ?? 0) + coeff * s1 - s2;
    s2 = s1;
    s1 = s0;
  }
  return s1 * s1 + s2 * s2 - coeff * s1 * s2;
}

/**
 * Demodulates `samples` into a stream of raw 0/1 bits (one element per symbol).
 * Output length: Math.floor(samples.length / samplesPerSymbol).
 * Returns empty Uint8Array if samples.length < samplesPerSymbol.
 */
export function demodulateBits(
  samples: Float32Array,
  config: ModemConfig,
): Uint8Array {
  validateConfig(config);

  const { sampleRate, markFrequency, spaceFrequency, samplesPerSymbol } =
    config;
  const numBits = Math.floor(samples.length / samplesPerSymbol);

  if (numBits === 0) return new Uint8Array(0);

  const bits = new Uint8Array(numBits);
  for (let i = 0; i < numBits; i++) {
    const offset = i * samplesPerSymbol;
    const eMark = goertzelEnergy(
      samples,
      offset,
      samplesPerSymbol,
      markFrequency,
      sampleRate,
    );
    const eSpace = goertzelEnergy(
      samples,
      offset,
      samplesPerSymbol,
      spaceFrequency,
      sampleRate,
    );
    // Tie goes to 0 (space) per Req 3.2
    bits[i] = eMark > eSpace ? 1 : 0;
  }
  return bits;
}

/**
 * Packs an array of 0/1 bits (MSB-first per byte) into a Uint8Array of bytes.
 * Trailing bits that don't fill a complete byte are discarded.
 */
export function packBits(bits: Uint8Array): Uint8Array {
  const numBytes = Math.floor(bits.length / 8);
  const out = new Uint8Array(numBytes);
  for (let b = 0; b < numBytes; b++) {
    let byte = 0;
    for (let bit = 0; bit < 8; bit++) {
      byte = (byte << 1) | (bits[b * 8 + bit] ?? 0);
    }
    out[b] = byte;
  }
  return out;
}

/**
 * Demodulates `samples` into packed bytes.
 * Output length: Math.floor(samples.length / (8 * samplesPerSymbol)).
 * Returns empty Uint8Array if fewer than 8 symbols of samples are present.
 */
export function demodulate(
  samples: Float32Array,
  config: ModemConfig,
): Uint8Array {
  validateConfig(config);
  return packBits(demodulateBits(samples, config));
}

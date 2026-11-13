/**
 * src/channel/rate-config.ts
 * Builds a ModemConfig for the sample rate the browser actually runs at.
 * Baud and tones always come from defaultConfig; only sampleRate changes, so nothing is resampled.
 * Requirements (slice 2): 1.1–1.5
 */

import { createConfig, defaultConfig, type ModemConfig } from "../modem/config.js";
import { codedLength } from "../protocol/fec.js";

/** Longest frame in bytes: 4 preamble + 2 sync + 1 length + 140 payload + 2 CRC. */
export const MAX_FRAME_BYTES = 149;

export function configForSampleRate(
  sampleRate: number,
  warn: (msg: string) => void = (m) => console.warn(m),
): ModemConfig {
  const config = createConfig({
    sampleRate,
    baudRate: defaultConfig.baudRate,
    markFrequency: defaultConfig.markFrequency,
    spaceFrequency: defaultConfig.spaceFrequency,
  });
  const cyclesMark = defaultConfig.markFrequency / defaultConfig.baudRate;
  const cyclesSpace = defaultConfig.spaceFrequency / defaultConfig.baudRate;
  const exact = sampleRate % defaultConfig.baudRate === 0;
  if (!exact || !Number.isInteger(cyclesMark) || !Number.isInteger(cyclesSpace)) {
    warn(
      `Handshake: sample rate ${sampleRate} Hz does not give a whole number of samples per symbol; ` +
        `symbols will be ${config.samplesPerSymbol} samples and decoding may be less reliable.`,
    );
  }
  return config;
}

/** The same tones at half the baud: slow mode, measured best through the air (2026-11-13: 5/5 vs 2/5). */
export function slowConfig(config: ModemConfig): ModemConfig {
  return createConfig({
    sampleRate: config.sampleRate,
    baudRate: config.baudRate / 2,
    markFrequency: config.markFrequency,
    spaceFrequency: config.spaceFrequency,
  });
}

/** Every rate a listener tries, fastest first. */
export function listenConfigs(config: ModemConfig): ModemConfig[] {
  return [config, slowConfig(config)];
}

/** Longest robust frame in bits: 48 header + coded length + coded (140 payload + 2 CRC), padded to a byte. */
const MAX_ROBUST_BITS = Math.ceil((48 + codedLength(8) + codedLength(8 * (140 + 2))) / 8) * 8;

/**
 * Ring-buffer size for the receiver: the longest frame it may have to hold (a robust frame at the
 * slowest listening rate) plus one second.
 */
export function rxBufferCapacity(config: ModemConfig): number {
  const slowest = config.baudRate / 2;
  const seconds = Math.max((MAX_FRAME_BYTES * 8) / config.baudRate, MAX_ROBUST_BITS / slowest);
  return Math.ceil(config.sampleRate * seconds) + config.sampleRate;
}

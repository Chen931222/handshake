/**
 * src/channel/rate-config.ts
 * Builds a ModemConfig for the sample rate the browser actually runs at.
 * Baud and tones always come from defaultConfig; only sampleRate changes, so nothing is resampled.
 * Requirements (slice 2): 1.1–1.5
 */

import { createConfig, defaultConfig, type ModemConfig } from "../modem/config.js";

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

/** Ring-buffer size for the receiver: the longest frame plus one second. */
export function rxBufferCapacity(config: ModemConfig): number {
  return (
    Math.ceil(config.sampleRate * ((MAX_FRAME_BYTES * 8) / config.baudRate)) + config.sampleRate
  );
}

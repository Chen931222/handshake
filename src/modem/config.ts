/**
 * src/modem/config.ts
 * Single source of truth for all FSK modem parameters.
 * Requirements: 1.1–1.5
 */

export interface ModemConfig {
  readonly sampleRate: number;       // Hz, e.g. 48000
  readonly baudRate: number;         // symbols/s, e.g. 100
  readonly markFrequency: number;    // Hz for bit 1
  readonly spaceFrequency: number;   // Hz for bit 0
  readonly samplesPerSymbol: number; // Math.round(sampleRate / baudRate) — derived
}

/**
 * Validates inputs and constructs a ModemConfig.
 * Throws RangeError naming the violated field if:
 *   sampleRate <= 0 | baudRate <= 0 | markFrequency === spaceFrequency
 */
export function createConfig(
  params: Omit<ModemConfig, "samplesPerSymbol">,
): ModemConfig {
  if (params.sampleRate <= 0) {
    throw new RangeError(
      `ModemConfig: sampleRate must be > 0, got ${params.sampleRate}`,
    );
  }
  if (params.baudRate <= 0) {
    throw new RangeError(
      `ModemConfig: baudRate must be > 0, got ${params.baudRate}`,
    );
  }
  if (params.markFrequency === params.spaceFrequency) {
    throw new RangeError(
      `ModemConfig: markFrequency and spaceFrequency must differ, both are ${params.markFrequency}`,
    );
  }

  const samplesPerSymbol = Math.round(params.sampleRate / params.baudRate);

  return {
    sampleRate: params.sampleRate,
    baudRate: params.baudRate,
    markFrequency: params.markFrequency,
    spaceFrequency: params.spaceFrequency,
    samplesPerSymbol,
  };
}

/**
 * Default configuration.
 * 48 000 Hz / 100 baud / mark=2400 Hz / space=1800 Hz.
 * Both tones are integer multiples of the baud rate (24 and 18 cycles/symbol),
 * so the Goertzel bins are orthogonal and both tones are inside 1.5–4 kHz.
 */
export const defaultConfig: ModemConfig = createConfig({
  sampleRate: 48_000,
  baudRate: 100,
  markFrequency: 2400,
  spaceFrequency: 1800,
});

/**
 * src/modem/clarity.ts
 * "Spirit clarity": how much of the received energy sits on the modem's tones.
 * For each symbol-length window, the larger of the mark/space Goertzel energies is divided
 * by the energy a pure tone of the same power would give. A clean tone scores 1, white noise
 * scores near 0, silence scores 0. This is the number the séance UI shows; nothing is faked.
 */

import type { ModemConfig } from "./config.js";

function goertzel(x: Float32Array, start: number, n: number, freq: number, rate: number): number {
  const coeff = 2 * Math.cos((2 * Math.PI * freq) / rate);
  let s1 = 0;
  let s2 = 0;
  for (let i = start; i < start + n; i++) {
    const s0 = x[i]! + coeff * s1 - s2;
    s2 = s1;
    s1 = s0;
  }
  return s1 * s1 + s2 * s2 - coeff * s1 * s2;
}

/**
 * Mean tone share over the windows that carry any energy, in [0, 1].
 * Windows quieter than `floor` (mean square) are skipped so silence does not dilute the score.
 */
export function toneClarity(samples: Float32Array, config: ModemConfig, floor = 1e-7): number {
  const n = config.samplesPerSymbol;
  let sum = 0;
  let count = 0;
  for (let start = 0; start + n <= samples.length; start += n) {
    let power = 0;
    for (let i = start; i < start + n; i++) power += samples[i]! * samples[i]!;
    if (power / n < floor) continue;
    const tone = Math.max(
      goertzel(samples, start, n, config.markFrequency, config.sampleRate),
      goertzel(samples, start, n, config.spaceFrequency, config.sampleRate),
    );
    sum += Math.min(1, tone / ((n / 2) * power));
    count++;
  }
  return count === 0 ? 0 : sum / count;
}

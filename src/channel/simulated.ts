/**
 * src/channel/simulated.ts
 * Simulated channel: applies controlled impairments to FSK audio samples.
 *
 * Pipeline (in this order, to avoid order-dependent SNR measurement errors):
 *   1. Gain  — uniform random multiplier from [gainMin, gainMax]
 *   2. Clock drift — linear-interpolation resample at rate r = 1 + ppm×1e-6
 *   3. Noise — white Gaussian (Box-Muller) at target SNR relative to original RMS
 *   4. Silence padding — prepend/append zero samples
 *
 * Requirements: 9.1–9.7
 * No Web Audio API.
 */

export interface ChannelOptions {
  /** Target SNR in dB. Default: Infinity (no noise). */
  snrDb?: number;
  /** Lower bound of gain multiplier. Default: 0.8 */
  gainMin?: number;
  /** Upper bound of gain multiplier. Default: 1.2 */
  gainMax?: number;
  /**
   * Clock drift in parts-per-million. Default: 0.
   * Clamped to [-300, +300]. Positive = receiver clock runs fast (tones appear lower).
   */
  clockDriftPpm?: number;
  /**
   * Seeded RNG for reproducible tests. Default: Math.random.
   * Must return values uniformly in [0, 1).
   */
  rng?: () => number;
  /** Zero samples prepended. Default: 0. */
  leadingSilenceSamples?: number;
  /** Zero samples appended. Default: 0. */
  trailingSilenceSamples?: number;
}

/**
 * Applies simulated channel impairments to `samples` and returns the result.
 * Output length = leadingSilenceSamples + samples.length + trailingSilenceSamples.
 */
export function simulateChannel(
  samples: Float32Array,
  options: ChannelOptions = {},
): Float32Array {
  const {
    snrDb = Infinity,
    gainMin = 0.8,
    gainMax = 1.2,
    clockDriftPpm = 0,
    rng = Math.random,
    leadingSilenceSamples = 0,
    trailingSilenceSamples = 0,
  } = options;

  const driftPpm = Math.max(-300, Math.min(300, clockDriftPpm));

  // ── 1. Compute original RMS before any modification (used for SNR target) ──
  let sumSq = 0;
  for (let i = 0; i < samples.length; i++) {
    sumSq += (samples[i]! ** 2);
  }
  const originalRms = samples.length > 0 ? Math.sqrt(sumSq / samples.length) : 0;

  // ── 2. Gain ──────────────────────────────────────────────────────────────
  const gain = gainMin + rng() * (gainMax - gainMin);
  const gained = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    gained[i] = samples[i]! * gain;
  }

  // ── 3. Clock drift (linear interpolation resample) ───────────────────────
  // y[n] = x(n * r) where r = 1 + ppm*1e-6
  // Positions past the end read as 0 (silence), length unchanged.
  const r = 1 + driftPpm * 1e-6;
  let drifted: Float32Array;
  if (driftPpm === 0) {
    drifted = gained;
  } else {
    drifted = new Float32Array(gained.length);
    for (let n = 0; n < gained.length; n++) {
      const src = n * r;
      const lo = Math.floor(src);
      const hi = lo + 1;
      const frac = src - lo;
      const vLo = lo < gained.length ? (gained[lo] ?? 0) : 0;
      const vHi = hi < gained.length ? (gained[hi] ?? 0) : 0;
      drifted[n] = vLo + frac * (vHi - vLo);
    }
  }

  // ── 4. Noise ──────────────────────────────────────────────────────────────
  // σ = originalRms / 10^(snrDb/20)
  // Box-Muller: u1 ∈ (0,1], u2 ∈ [0,1)
  //   noise = σ * sqrt(-2*ln(u1)) * cos(2π*u2)
  let noisy: Float32Array;
  if (!isFinite(snrDb) || originalRms === 0) {
    noisy = drifted;
  } else {
    const sigma = originalRms / Math.pow(10, snrDb / 20);
    noisy = new Float32Array(drifted.length);
    for (let i = 0; i < drifted.length; i++) {
      const u1 = 1 - rng(); // u1 in (0,1] — avoids log(0)
      const u2 = rng();
      const noise = sigma * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
      noisy[i] = drifted[i]! + noise;
    }
  }

  // ── 5. Silence padding ────────────────────────────────────────────────────
  const lead = Math.max(0, Math.floor(leadingSilenceSamples));
  const trail = Math.max(0, Math.floor(trailingSilenceSamples));
  const out = new Float32Array(lead + noisy.length + trail);
  out.set(noisy, lead);
  // leading and trailing regions are already 0 (Float32Array default)

  return out;
}

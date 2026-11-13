/**
 * test/noise.test.ts
 * Tasks 9.1, 9.2, 9.3 — Requirements 8.1–8.5, 10.1–10.5
 *
 * Property 10: noise-resistance — receive() never returns a wrong payload.
 * Non-vacuity companion (Req 8.4): at snrDb=Infinity, 100% of cases succeed.
 * SNR sweep report (Req 10): 50 payloads × {30,20,10,5,0} dB, console.table output.
 *
 * Seeded LCG passed into simulateChannel so any fast-check counterexample reproduces
 * exactly from the printed seed + rngSeed integer.
 */

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { defaultConfig } from "../src/modem/config.js";
import { modulate } from "../src/modem/modulator.js";
import { encodeFrame } from "../src/protocol/frame.js";
import { receive } from "../src/modem/receiver.js";
import { simulateChannel } from "../src/channel/simulated.js";

const enc = new TextEncoder();

// ── Seeded LCG (same as channel.test.ts, inlined to avoid cross-file dep) ───
function makeLcg(seed: number): () => number {
  // mulberry32 (2026-11-13): an LCG seeded with consecutive integers gave correlated noise
  // across trials, so a sweep's 50 trials were not independent.
  let a = Math.round(seed) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Full pipeline: bytes → frame → samples → channel → receive */
function roundTrip(
  payload: Uint8Array,
  snrDb: number,
  leadingSilenceSamples: number,
  trailingSilenceSamples: number,
  clockDriftPpm: number,
  rng: () => number,
) {
  const frame = encodeFrame(payload);
  const samples = modulate(frame, defaultConfig);
  const impaired = simulateChannel(samples, {
    snrDb,
    leadingSilenceSamples,
    trailingSilenceSamples,
    clockDriftPpm,
    gainMin: 0.8,
    gainMax: 1.2,
    rng,
  });
  return receive(impaired, defaultConfig);
}

// ── Property 10: noise-resistance ────────────────────────────────────────────
// Feature: handshake-modem-slice-1, Property 10: Noise-resistance — no silent wrong accepts
describe("noise-resistance — Property 10 (task 9.1)", () => {
  it(
    "receive() never returns a wrong payload under any noise/silence/drift combination",
    () => {
      fc.assert(
        fc.property(
          fc.uint8Array({ minLength: 1, maxLength: 140 }),
          // −15 and −20 dB are where frames actually get corrupted; without them the CRC is never exercised
          fc.constantFrom(Infinity, 30, 20, 10, 5, 0, -15, -20),
          // Leading silence: 0 to 3×samplesPerSymbol (non-aligned by design)
          fc.integer({ min: 0, max: 3 * defaultConfig.samplesPerSymbol }),
          // Trailing silence: 0 to 1×samplesPerSymbol
          fc.integer({ min: 0, max: defaultConfig.samplesPerSymbol }),
          // Clock drift: −200 to +200 ppm
          fc.integer({ min: -200, max: 200 }),
          // RNG seed — makes the channel impairments reproducible from this integer
          fc.integer({ min: 1, max: 0x7fff_ffff }),
          (payload, snrDb, leading, trailing, driftPpm, rngSeed) => {
            const result = roundTrip(
              payload,
              snrDb,
              leading,
              trailing,
              driftPpm,
              makeLcg(rngSeed),
            );

            if (result.ok) {
              // THE core invariant: if ok, payload must match exactly (Req 8.2)
              expect(result.payload.length).toBe(payload.length);
              for (let i = 0; i < payload.length; i++) {
                expect(result.payload[i]).toBe(payload[i]);
              }
            }
            // ok:false is always acceptable — the decoder correctly reported failure
          },
        ),
        { numRuns: 100, seed: 42 },
      );
    },
  );
});

// ── Non-vacuity companion (Req 8.4) ─────────────────────────────────────────
// At snrDb=Infinity the decoder must ALWAYS succeed, proving the property
// above is not trivially satisfied by a decoder that always returns ok:false.
describe("non-vacuity companion at snrDb=Infinity (task 9.2, Req 8.4)", () => {
  it(
    "receive() returns ok:true with exact payload for 100/100 cases at snrDb=Infinity",
    () => {
      fc.assert(
        fc.property(
          fc.uint8Array({ minLength: 1, maxLength: 140 }),
          fc.integer({ min: 0, max: 3 * defaultConfig.samplesPerSymbol }),
          fc.integer({ min: 0, max: defaultConfig.samplesPerSymbol }),
          fc.integer({ min: -200, max: 200 }),
          fc.integer({ min: 1, max: 0x7fff_ffff }),
          (payload, leading, trailing, driftPpm, rngSeed) => {
            const result = roundTrip(
              payload,
              Infinity,
              leading,
              trailing,
              driftPpm,
              makeLcg(rngSeed),
            );

            // At Infinity SNR, decode MUST succeed
            expect(result.ok).toBe(true);
            if (result.ok) {
              expect(result.payload.length).toBe(payload.length);
              for (let i = 0; i < payload.length; i++) {
                expect(result.payload[i]).toBe(payload[i]);
              }
            }
          },
        ),
        { numRuns: 100, seed: 42 },
      );
    },
  );
});

// ── SNR sweep report (task 9.3, Req 10) ─────────────────────────────────────
describe("SNR sweep report (task 9.3, Req 10)", () => {
  it("prints success rate table for SNR 30/20/10/5/0 dB and asserts rates are in [0,100]", () => {
    // Req 10 levels plus negative SNRs: the noise is white over 0–24 kHz while each bit is judged in a
    // ~100 Hz Goertzel bin over 480 samples (~24 dB processing gain), so 0 dB alone shows no failures.
    const SNR_LEVELS = [30, 20, 10, 5, 0, -5, -10, -15, -20];
    const ATTEMPTS = 50;
    const FIXED_SEED = 1234;

    // Generate 50 payloads once with a fixed seed; reuse across all SNR levels
    // so the table shows the effect of noise, not payload variation.
    const payloads = fc.sample(
      // fast-check's sample() takes numRuns, not count (count was silently ignored → 100 payloads)
      fc.string({ minLength: 1, maxLength: 140, unit: "grapheme" }).filter((s) => enc.encode(s).length <= 140),
      { numRuns: ATTEMPTS, seed: FIXED_SEED },
    ).map((s) => enc.encode(s));

    const rows: Array<{
      "SNR (dB)": number;
      Attempts: number;
      Successes: number;
      "Success Rate (%)": string;
    }> = [];

    for (const snrDb of SNR_LEVELS) {
      let successes = 0;

      for (let i = 0; i < payloads.length; i++) {
        const payload = payloads[i]!;
        // Each trial gets its own deterministic RNG derived from SNR level + trial index
        const rng = makeLcg((snrDb + 1) * 1000 + i);
        const leading = Math.floor(rng() * 3 * defaultConfig.samplesPerSymbol);
        const trailing = Math.floor(rng() * defaultConfig.samplesPerSymbol);
        const driftPpm = Math.floor(rng() * 401) - 200;

        const result = roundTrip(payload, snrDb, leading, trailing, driftPpm, rng);
        if (result.ok) {
          // Verify correctness even in the report test (belt-and-suspenders)
          let match = result.payload.length === payload.length;
          for (let j = 0; match && j < payload.length; j++) {
            if (result.payload[j] !== payload[j]) match = false;
          }
          if (match) successes++;
        }
      }

      expect(payloads.length).toBe(ATTEMPTS);
      const rate = (successes / payloads.length) * 100;
      // Req 10.4: each rate must be a finite number in [0, 100]
      expect(Number.isFinite(rate)).toBe(true);
      expect(rate).toBeGreaterThanOrEqual(0);
      expect(rate).toBeLessThanOrEqual(100);

      rows.push({
        "SNR (dB)": snrDb,
        Attempts: ATTEMPTS,
        Successes: successes,
        "Success Rate (%)": rate.toFixed(1),
      });
    }

    // Req 10.3: log the table
    console.table(rows);
  });
});

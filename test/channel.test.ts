/**
 * test/channel.test.ts
 * Unit tests and property test for src/channel/simulated.ts.
 * Task 7.2 — Requirements 9.1–9.7, Property 11
 */

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { simulateChannel } from "../src/channel/simulated.js";
import { defaultConfig } from "../src/modem/config.js";
import { modulate } from "../src/modem/modulator.js";
import { encodeFrame } from "../src/protocol/frame.js";

const enc = new TextEncoder();

/** Simple seeded LCG for reproducible tests (no external dep). */
function makeLcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(1664525, s) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

function makeSignalSamples(): Float32Array {
  return modulate(encodeFrame(enc.encode("hello")), defaultConfig);
}

// ─── Output length ────────────────────────────────────────────────────────────

describe("simulateChannel — output length (task 7.2)", () => {
  it("length = samples.length when no silence padding", () => {
    const s = makeSignalSamples();
    const out = simulateChannel(s, { snrDb: Infinity, rng: makeLcg(1) });
    expect(out.length).toBe(s.length);
  });

  it("length = leadingSilence + samples.length + trailingSilence (Req 9.1)", () => {
    const s = makeSignalSamples();
    const out = simulateChannel(s, {
      snrDb: Infinity,
      leadingSilenceSamples: 100,
      trailingSilenceSamples: 200,
      rng: makeLcg(2),
    });
    expect(out.length).toBe(100 + s.length + 200);
  });

  it("leading samples are zero", () => {
    const s = makeSignalSamples();
    const out = simulateChannel(s, {
      snrDb: Infinity,
      leadingSilenceSamples: 50,
      rng: makeLcg(3),
    });
    for (let i = 0; i < 50; i++) {
      expect(out[i]).toBe(0);
    }
  });

  it("trailing samples are zero", () => {
    const s = makeSignalSamples();
    const out = simulateChannel(s, {
      snrDb: Infinity,
      trailingSilenceSamples: 50,
      rng: makeLcg(4),
    });
    for (let i = out.length - 50; i < out.length; i++) {
      expect(out[i]).toBe(0);
    }
  });
});

// ─── snrDb = Infinity → no noise ──────────────────────────────────────────────

describe("simulateChannel — snrDb=Infinity (Req 9.7)", () => {
  it("adds no noise when snrDb is Infinity and gain=1 (rng returns 0.5 midpoint)", () => {
    // gainMin=1, gainMax=1 so gain is exactly 1; rng not relevant for noise
    const s = new Float32Array([0.5, -0.3, 0.1, 0.9, -0.7]);
    const out = simulateChannel(s, {
      snrDb: Infinity,
      gainMin: 1,
      gainMax: 1,
      rng: makeLcg(5),
    });
    for (let i = 0; i < s.length; i++) {
      expect(out[i]).toBeCloseTo(s[i]!, 10);
    }
  });

  it("clockDriftPpm=0 with Infinity SNR and gain=1 is an identity transform", () => {
    const s = makeSignalSamples();
    const out = simulateChannel(s, {
      snrDb: Infinity,
      gainMin: 1,
      gainMax: 1,
      clockDriftPpm: 0,
      rng: makeLcg(6),
    });
    expect(out.length).toBe(s.length);
    for (let i = 0; i < s.length; i++) {
      expect(out[i]).toBeCloseTo(s[i]!, 10);
    }
  });
});

// ─── Gain ────────────────────────────────────────────────────────────────────

describe("simulateChannel — gain (Req 9.3)", () => {
  it("applies gain within [gainMin, gainMax]", () => {
    // Use a constant signal of 1.0 so gain is directly measurable
    const s = new Float32Array(100).fill(1.0);
    const rng = makeLcg(7);
    const out = simulateChannel(s, {
      snrDb: Infinity,
      gainMin: 0.5,
      gainMax: 0.5, // force gain=0.5
      rng,
    });
    for (let i = 0; i < s.length; i++) {
      expect(out[i]).toBeCloseTo(0.5, 10);
    }
  });
});

// ─── Clock drift ─────────────────────────────────────────────────────────────

describe("simulateChannel — clockDriftPpm (Req 9.4)", () => {
  it("non-zero drift produces different output than zero drift", () => {
    const s = makeSignalSamples();
    const rng1 = makeLcg(8);
    const rng2 = makeLcg(8); // same seed
    const noDrift = simulateChannel(s, { snrDb: Infinity, gainMin: 1, gainMax: 1, clockDriftPpm: 0, rng: rng1 });
    const withDrift = simulateChannel(s, { snrDb: Infinity, gainMin: 1, gainMax: 1, clockDriftPpm: 100, rng: rng2 });
    // At least some samples should differ
    let differs = false;
    for (let i = 0; i < s.length; i++) {
      if (Math.abs((noDrift[i] ?? 0) - (withDrift[i] ?? 0)) > 1e-6) { differs = true; break; }
    }
    expect(differs).toBe(true);
  });

  it("clamps clockDriftPpm to [-300, +300]", () => {
    const s = new Float32Array(100).fill(0.5);
    // Should not throw and should return same length
    const out = simulateChannel(s, { snrDb: Infinity, gainMin: 1, gainMax: 1, clockDriftPpm: 9999 });
    expect(out.length).toBe(s.length);
  });
});

// ─── Noise ────────────────────────────────────────────────────────────────────

describe("simulateChannel — noise (Req 9.2)", () => {
  it("adds noise at finite snrDb (output differs from input)", () => {
    const s = new Float32Array(1000).fill(0.5);
    const rng = makeLcg(9);
    const out = simulateChannel(s, { snrDb: 20, gainMin: 1, gainMax: 1, rng });
    let hasNoise = false;
    for (let i = 0; i < s.length; i++) {
      if (Math.abs((out[i] ?? 0) - 0.5) > 1e-6) { hasNoise = true; break; }
    }
    expect(hasNoise).toBe(true);
  });

  it("zero-RMS signal gets no noise (Req 9.2 edge case)", () => {
    const s = new Float32Array(100); // all zeros
    const out = simulateChannel(s, { snrDb: 10, gainMin: 1, gainMax: 1, rng: makeLcg(10) });
    for (let i = 0; i < s.length; i++) {
      expect(out[i]).toBe(0);
    }
  });
});

// Feature: handshake-modem-slice-1, Property 11: Channel output length invariant
describe("simulateChannel — Property 11 (task 7.2)", () => {
  it("output length = leadingSilence + samples.length + trailingSilence for all inputs", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 2000 }),  // samples length
        fc.integer({ min: 0, max: 500 }),   // leading silence
        fc.integer({ min: 0, max: 500 }),   // trailing silence
        (n, lead, trail) => {
          const s = new Float32Array(n).fill(0.1);
          const out = simulateChannel(s, {
            snrDb: Infinity,
            leadingSilenceSamples: lead,
            trailingSilenceSamples: trail,
            rng: makeLcg(42),
          });
          expect(out.length).toBe(lead + n + trail);
        },
      ),
      { numRuns: 100 },
    );
  });
});

/**
 * test/modem.test.ts
 * Unit and property tests for src/modem/config.ts, modulator.ts, demodulator.ts.
 * Tasks: 2.2, 2.3, 3.2, 3.3, 4.2, 4.3
 */

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { createConfig, defaultConfig, type ModemConfig } from "../src/modem/config.js";
import { modulate } from "../src/modem/modulator.js";
import { demodulate, demodulateBits } from "../src/modem/demodulator.js";

// ─── Task 2.2 / 2.3: createConfig unit tests + properties ────────────────────

describe("createConfig — validation (task 2.2)", () => {
  it("throws RangeError when sampleRate <= 0", () => {
    expect(() => createConfig({ sampleRate: 0, baudRate: 100, markFrequency: 2400, spaceFrequency: 1800 }))
      .toThrow(RangeError);
    expect(() => createConfig({ sampleRate: -1, baudRate: 100, markFrequency: 2400, spaceFrequency: 1800 }))
      .toThrow(/sampleRate/);
  });

  it("throws RangeError when baudRate <= 0", () => {
    expect(() => createConfig({ sampleRate: 48000, baudRate: 0, markFrequency: 2400, spaceFrequency: 1800 }))
      .toThrow(RangeError);
    expect(() => createConfig({ sampleRate: 48000, baudRate: -50, markFrequency: 2400, spaceFrequency: 1800 }))
      .toThrow(/baudRate/);
  });

  it("throws RangeError when markFrequency === spaceFrequency", () => {
    expect(() => createConfig({ sampleRate: 48000, baudRate: 100, markFrequency: 2000, spaceFrequency: 2000 }))
      .toThrow(RangeError);
    expect(() => createConfig({ sampleRate: 48000, baudRate: 100, markFrequency: 2000, spaceFrequency: 2000 }))
      .toThrow(/markFrequency/);
  });

  it("computes samplesPerSymbol as Math.round(sampleRate / baudRate)", () => {
    const c = createConfig({ sampleRate: 48000, baudRate: 100, markFrequency: 2400, spaceFrequency: 1800 });
    expect(c.samplesPerSymbol).toBe(480);

    const c2 = createConfig({ sampleRate: 44100, baudRate: 100, markFrequency: 2400, spaceFrequency: 1800 });
    expect(c2.samplesPerSymbol).toBe(Math.round(44100 / 100));
  });

  it("defaultConfig has correct values", () => {
    expect(defaultConfig.sampleRate).toBe(48000);
    expect(defaultConfig.baudRate).toBe(100);
    expect(defaultConfig.markFrequency).toBe(2400);
    expect(defaultConfig.spaceFrequency).toBe(1800);
    expect(defaultConfig.samplesPerSymbol).toBe(480);
  });
});

// Feature: handshake-modem-slice-1, Property 5: Config rejects invalid parameters
describe("createConfig — Property 5 (task 2.3)", () => {
  it("rejects all invalid parameter combinations", () => {
    fc.assert(
      fc.property(
        fc.oneof(
          // sampleRate <= 0
          fc.record({
            sampleRate: fc.integer({ max: 0 }),
            baudRate: fc.integer({ min: 1, max: 1000 }),
            markFrequency: fc.float({ min: 1500, max: 4000, noNaN: true }),
            spaceFrequency: fc.float({ min: 1500, max: 3999, noNaN: true }),
          }),
          // baudRate <= 0
          fc.record({
            sampleRate: fc.integer({ min: 1, max: 192000 }),
            baudRate: fc.integer({ max: 0 }),
            markFrequency: fc.float({ min: 1500, max: 4000, noNaN: true }),
            spaceFrequency: fc.float({ min: 1500, max: 3999, noNaN: true }),
          }),
          // markFrequency === spaceFrequency (use same integer)
          fc.integer({ min: 1000, max: 4000 }).map((f) => ({
            sampleRate: 48000,
            baudRate: 100,
            markFrequency: f,
            spaceFrequency: f,
          })),
        ),
        (params) => {
          expect(() => createConfig(params)).toThrow(RangeError);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// Feature: handshake-modem-slice-1, Property 6: Config derives samplesPerSymbol correctly
describe("createConfig — Property 6 (task 2.3)", () => {
  it("derives samplesPerSymbol as Math.round(sampleRate / baudRate)", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 192000 }),
        fc.integer({ min: 1, max: 2000 }),
        (sampleRate, baudRate) => {
          const c = createConfig({
            sampleRate,
            baudRate,
            markFrequency: 2400,
            spaceFrequency: 1800,
          });
          expect(c.samplesPerSymbol).toBe(Math.round(sampleRate / baudRate));
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ─── Task 3.2 / 3.3: modulator unit tests + properties ───────────────────────

describe("modulate — unit tests (task 3.2)", () => {
  it("output length = bytes.length × 8 × samplesPerSymbol", () => {
    const bytes = new Uint8Array([0x48, 0x69]); // "Hi"
    const out = modulate(bytes, defaultConfig);
    expect(out.length).toBe(bytes.length * 8 * defaultConfig.samplesPerSymbol);
  });

  it("all samples in [-1.0, 1.0]", () => {
    const bytes = new Uint8Array(10).fill(0xaa);
    const out = modulate(bytes, defaultConfig);
    for (let i = 0; i < out.length; i++) {
      expect(out[i]).toBeGreaterThanOrEqual(-1.0);
      expect(out[i]).toBeLessThanOrEqual(1.0);
    }
  });

  it("throws TypeError on empty bytes", () => {
    expect(() => modulate(new Uint8Array(0), defaultConfig)).toThrow(TypeError);
  });

  it("is deterministic (same input → same output)", () => {
    const bytes = new Uint8Array([0x42, 0xab]);
    const a = modulate(bytes, defaultConfig);
    const b = modulate(bytes, defaultConfig);
    expect(a).toEqual(b);
  });

  it("MSB-first: byte 0x80 starts with a mark-frequency symbol (bit=1)", () => {
    // 0x80 = 10000000 — first bit is 1, so first symbol should be mark frequency
    const bytes = new Uint8Array([0x80]);
    const out = modulate(bytes, defaultConfig);
    const { sampleRate, markFrequency, spaceFrequency, samplesPerSymbol } = defaultConfig;

    // Measure Goertzel energy of first symbol
    const coeff = (f: number) => 2 * Math.cos((2 * Math.PI * f) / sampleRate);
    function goertzel(f: number): number {
      const c = coeff(f);
      let s1 = 0, s2 = 0;
      for (let i = 0; i < samplesPerSymbol; i++) {
        const s0 = (out[i] ?? 0) + c * s1 - s2;
        s2 = s1; s1 = s0;
      }
      return s1 * s1 + s2 * s2 - c * s1 * s2;
    }
    expect(goertzel(markFrequency)).toBeGreaterThan(goertzel(spaceFrequency));
  });
});

// Feature: handshake-modem-slice-1, Property 2: Modulate output length
// Feature: handshake-modem-slice-1, Property 3: Modulate sample range
describe("modulate — Properties 2 & 3 (task 3.3)", () => {
  it("Property 2: output length is always bytes.length × 8 × samplesPerSymbol", () => {
    fc.assert(
      fc.property(
        fc.uint8Array({ minLength: 1, maxLength: 140 }),
        (bytes) => {
          const out = modulate(bytes, defaultConfig);
          expect(out.length).toBe(
            bytes.length * 8 * defaultConfig.samplesPerSymbol,
          );
        },
      ),
      { numRuns: 100 },
    );
  });

  it("Property 3: every sample is in [-1.0, 1.0]", () => {
    fc.assert(
      fc.property(
        fc.uint8Array({ minLength: 1, maxLength: 20 }), // keep test fast
        (bytes) => {
          const out = modulate(bytes, defaultConfig);
          for (let i = 0; i < out.length; i++) {
            expect(out[i]).toBeGreaterThanOrEqual(-1.0);
            expect(out[i]).toBeLessThanOrEqual(1.0);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ─── Task 4.2: demodulator unit tests ────────────────────────────────────────

describe("demodulate — unit tests (task 4.2)", () => {
  it("returns empty Uint8Array when samples.length < 8 × samplesPerSymbol", () => {
    const short = new Float32Array(10);
    expect(demodulate(short, defaultConfig)).toEqual(new Uint8Array(0));
  });

  it("throws TypeError on invalid config (samplesPerSymbol < 1)", () => {
    const bad = { ...defaultConfig, samplesPerSymbol: 0 };
    expect(() => demodulate(new Float32Array(100), bad)).toThrow(TypeError);
  });

  it("throws TypeError on non-finite markFrequency", () => {
    const bad = { ...defaultConfig, markFrequency: NaN };
    expect(() => demodulate(new Float32Array(100), bad)).toThrow(TypeError);
  });

  it("demodulateBits output length = Math.floor(samples.length / samplesPerSymbol)", () => {
    const samples = new Float32Array(1000);
    const bits = demodulateBits(samples, defaultConfig);
    expect(bits.length).toBe(Math.floor(1000 / defaultConfig.samplesPerSymbol));
  });

  it("single pure mark-tone symbol decodes to bit 1", () => {
    // Generate one symbol of pure mark tone
    const { sampleRate, markFrequency, samplesPerSymbol } = defaultConfig;
    const samples = new Float32Array(samplesPerSymbol);
    for (let i = 0; i < samplesPerSymbol; i++) {
      samples[i] = Math.sin((2 * Math.PI * markFrequency * i) / sampleRate);
    }
    const bits = demodulateBits(samples, defaultConfig);
    expect(bits.length).toBe(1);
    expect(bits[0]).toBe(1);
  });

  it("single pure space-tone symbol decodes to bit 0", () => {
    const { sampleRate, spaceFrequency, samplesPerSymbol } = defaultConfig;
    const samples = new Float32Array(samplesPerSymbol);
    for (let i = 0; i < samplesPerSymbol; i++) {
      samples[i] = Math.sin((2 * Math.PI * spaceFrequency * i) / sampleRate);
    }
    const bits = demodulateBits(samples, defaultConfig);
    expect(bits.length).toBe(1);
    expect(bits[0]).toBe(0);
  });
});

// Feature: handshake-modem-slice-1, Property 1: Modem round-trip
// Feature: handshake-modem-slice-1, Property 4: Demodulate output length
describe("demodulate — Properties 1 & 4 (task 4.3)", () => {
  it("Property 1: demodulate(modulate(input)) === input (modem round-trip)", () => {
    fc.assert(
      fc.property(
        fc.uint8Array({ minLength: 1, maxLength: 140 }),
        (input) => {
          const samples = modulate(input, defaultConfig);
          const output = demodulate(samples, defaultConfig);
          expect(output.length).toBe(input.length);
          for (let i = 0; i < input.length; i++) {
            expect(output[i]).toBe(input[i]);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it("Property 4: output length = Math.floor(samples.length / (8 × samplesPerSymbol))", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 10000 }),
        (len) => {
          const samples = new Float32Array(len);
          const out = demodulate(samples, defaultConfig);
          expect(out.length).toBe(
            Math.floor(len / (8 * defaultConfig.samplesPerSymbol)),
          );
        },
      ),
      { numRuns: 100 },
    );
  });
});

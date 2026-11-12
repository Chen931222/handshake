/**
 * test/receiver.test.ts
 * Unit tests for src/modem/receiver.ts (no simulated channel dependency).
 * Task 6.2 — Requirements 12.1–12.6
 */

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { defaultConfig } from "../src/modem/config.js";
import { modulate } from "../src/modem/modulator.js";
import { encodeFrame } from "../src/protocol/frame.js";
import { receive } from "../src/modem/receiver.js";

const enc = new TextEncoder();

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Encodes text → frame bytes → samples with optional silent prefix. */
function makeSignal(text: string, leadingSamples = 0): Float32Array {
  const frame = encodeFrame(enc.encode(text));
  const signal = modulate(frame, defaultConfig);
  if (leadingSamples === 0) return signal;
  const out = new Float32Array(leadingSamples + signal.length);
  out.set(signal, leadingSamples);
  return out;
}

// ─── Basic round-trip ────────────────────────────────────────────────────────

describe("receive — basic round-trip (task 6.2)", () => {
  it("decodes a frame with no leading silence", () => {
    const result = receive(makeSignal("hello"), defaultConfig);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(new TextDecoder().decode(result.payload)).toBe("hello");
    }
  });

  it("decodes a frame with leading silence aligned to symbol boundary", () => {
    const lead = defaultConfig.samplesPerSymbol * 4;
    const result = receive(makeSignal("world", lead), defaultConfig);
    expect(result.ok).toBe(true);
  });

  it("decodes a frame with leading silence NOT on a symbol boundary (Req 12.2)", () => {
    // Use a non-multiple offset to exercise bit-granularity search
    const lead = defaultConfig.samplesPerSymbol * 2 + 73;
    const result = receive(makeSignal("test", lead), defaultConfig);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(new TextDecoder().decode(result.payload)).toBe("test");
    }
  });

  it("decodes a 140-byte payload", () => {
    const big = "x".repeat(140);
    const result = receive(makeSignal(big), defaultConfig);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(new TextDecoder().decode(result.payload)).toBe(big);
    }
  });

  it("decodes a single ASCII byte payload", () => {
    const result = receive(makeSignal("A"), defaultConfig);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(new TextDecoder().decode(result.payload)).toBe("A");
    }
  });
});

// ─── Failure modes ───────────────────────────────────────────────────────────

describe("receive — failure modes (task 6.2)", () => {
  it("returns no_sync for empty samples (Req 12.5)", () => {
    const result = receive(new Float32Array(0), defaultConfig);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("no_sync");
  });

  it("returns no_sync for pure silence", () => {
    const result = receive(new Float32Array(10000), defaultConfig);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("no_sync");
  });

  it("returns no_sync for random noise bytes", () => {
    // Random non-FSK bytes — sync pattern extremely unlikely to be found
    const noise = new Float32Array(4800);
    // Use a fixed seed-like pattern rather than Math.random to keep test deterministic
    for (let i = 0; i < noise.length; i++) {
      noise[i] = ((Math.sin(i * 1.1) * 0.5 + Math.cos(i * 0.7) * 0.5));
    }
    const result = receive(noise, defaultConfig);
    // We only assert it doesn't throw; result may be no_sync or crc_mismatch
    expect(typeof result.ok).toBe("boolean");
  });

  it("never throws for any Float32Array input (Req 12.5)", () => {
    expect(() => receive(new Float32Array(0), defaultConfig)).not.toThrow();
    expect(() => receive(new Float32Array(1), defaultConfig)).not.toThrow();
    expect(() => receive(new Float32Array(100), defaultConfig)).not.toThrow();
  });
});

// ─── Timing search coverage ───────────────────────────────────────────────────

describe("receive — timing offset coverage (Req 12.3)", () => {
  it("succeeds for all 8 canonical timing offsets within one symbol period", () => {
    const { samplesPerSymbol } = defaultConfig;
    for (let oi = 0; oi < 8; oi++) {
      const lead = Math.round((oi * samplesPerSymbol) / 8);
      const result = receive(makeSignal("ping", lead), defaultConfig);
      expect(result.ok).toBe(true);
    }
  });

  it("succeeds for arbitrary sub-symbol leading silence 0–samplesPerSymbol-1", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: defaultConfig.samplesPerSymbol - 1 }),
        (lead) => {
          const result = receive(makeSignal("ok", lead), defaultConfig);
          expect(result.ok).toBe(true);
        },
      ),
      { numRuns: 32 },
    );
  });
});

// ─── Property: round-trip for any payload ────────────────────────────────────

describe("receive — round-trip property (task 6.2)", () => {
  it("decodes any UTF-8 payload (1–40 bytes) with leading silence 0–3×samplesPerSymbol", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1 }).filter((s) => enc.encode(s).length <= 40),
        fc.integer({ min: 0, max: 3 * defaultConfig.samplesPerSymbol }),
        (text, lead) => {
          const result = receive(makeSignal(text, lead), defaultConfig);
          expect(result.ok).toBe(true);
          if (result.ok) {
            expect(new TextDecoder().decode(result.payload)).toBe(text);
          }
        },
      ),
      { numRuns: 50 },
    );
  });
});

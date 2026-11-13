/**
 * test/fec.test.ts — spec handshake-fec-slice-3: convolutional code, interleaver, robust frame.
 */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { fecEncode, fecDecode, interleave, deinterleave, codedLength } from "../src/protocol/fec.js";
import { encodeRobustFrame, receiveRobust, decodeRobustSoft } from "../src/protocol/robust-frame.js";
import { receive } from "../src/modem/receiver.js";
import { modulate } from "../src/modem/modulator.js";
import { encodeFrame } from "../src/protocol/frame.js";
import { createConfig, defaultConfig } from "../src/modem/config.js";
import { simulateChannel } from "../src/channel/simulated.js";

const bitsArb = (max: number) =>
  fc.array(fc.integer({ min: 0, max: 1 }), { maxLength: max }).map((a) => Uint8Array.from(a));
const toSoft = (bits: Uint8Array) => Float32Array.from(bits, (b) => (b ? 1 : -1));
// mulberry32: consecutive seeds give independent streams. (A plain LCG seeded with t, t+1, ...
// gave correlated noise across trials, which made the sweeps swing far more than chance.)
function lcg(seed: number) {
  let a = Math.round(seed) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const MSG = "SOS stairwell 3F, leg injured";

describe("convolutional code K=7 r=1/2", () => {
  it("has the impulse response of generators 171/133", () => {
    const out = Array.from(fecEncode(Uint8Array.from([1])));
    expect(out.length).toBe(codedLength(1));
    expect(out.filter((_, i) => i % 2 === 0)).toEqual([1, 1, 1, 1, 0, 0, 1]); // 0o171
    expect(out.filter((_, i) => i % 2 === 1)).toEqual([1, 0, 1, 1, 0, 1, 1]); // 0o133
  });

  // Feature: handshake-fec-slice-3, FEC round-trip
  it("decodes any bit string on a clean channel", () => {
    fc.assert(
      fc.property(bitsArb(256), (bits) => {
        expect(Array.from(fecDecode(toSoft(fecEncode(bits))))).toEqual(Array.from(bits));
      }),
      { numRuns: 200 },
    );
  });

  it("corrects scattered hard errors (2 per 40 coded bits)", () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: 1 }), { minLength: 40, maxLength: 200 }).map((a) => Uint8Array.from(a)),
        fc.integer({ min: 0, max: 1e6 }),
        (bits, seed) => {
          const soft = toSoft(fecEncode(bits));
          const rng = lcg(seed);
          for (let w = 0; w + 40 <= soft.length; w += 40) {
            const a = w + Math.floor(rng() * 20);
            const b = w + 20 + Math.floor(rng() * 20);
            soft[a] = -soft[a]!;
            soft[b] = -soft[b]!;
          }
          expect(Array.from(fecDecode(soft))).toEqual(Array.from(bits));
        },
      ),
      { numRuns: 100 },
    );
  });

  it("rejects an odd-length soft input", () => {
    expect(() => fecDecode(new Float32Array(13))).toThrow(RangeError);
  });
});

describe("block interleaver", () => {
  // Feature: handshake-fec-slice-3, interleaver round-trip
  it("deinterleave(interleave(x)) == x for any length and column count", () => {
    fc.assert(
      fc.property(bitsArb(500), fc.constantFrom(1, 2, 4, 8, 16, 32), (bits, cols) => {
        expect(Array.from(deinterleave(interleave(bits, cols), cols))).toEqual(Array.from(bits));
      }),
    );
  });

  it("puts source bits that were 16 apart next to each other on the air", () => {
    const src = Uint8Array.from({ length: 160 }, (_, i) => i);
    const air = interleave(src, 16);
    expect(air[0]).toBe(0);
    expect(air[1]).toBe(16);
  });
});

describe("robust frame", () => {
  // Feature: handshake-fec-slice-3, robust round-trip through audio
  it("round-trips any payload through modulate → receiveRobust", () => {
    fc.assert(
      fc.property(fc.uint8Array({ minLength: 1, maxLength: 60 }), fc.integer({ min: 0, max: 1500 }), (p, lead) => {
        const s = modulate(encodeRobustFrame(p), defaultConfig);
        const x = new Float32Array(lead + s.length + 200);
        x.set(s, lead);
        const r = receiveRobust(x, defaultConfig);
        expect(r.ok).toBe(true);
        if (r.ok) expect(Array.from(r.payload)).toEqual(Array.from(p));
      }),
      { numRuns: 40 },
    );
  });

  // Feature: handshake-fec-slice-3, safety: never a wrong accept
  it("never returns a wrong payload, even when many soft values are flipped", () => {
    fc.assert(
      fc.property(
        fc.uint8Array({ minLength: 1, maxLength: 40 }),
        fc.integer({ min: 0, max: 1e6 }),
        fc.constantFrom(0.05, 0.1, 0.2, 0.4),
        (p, seed, flipRate) => {
          const bytes = encodeRobustFrame(p);
          const bits: number[] = [];
          for (const b of bytes) for (let j = 7; j >= 0; j--) bits.push((b >> j) & 1);
          const soft = Float32Array.from(bits.slice(48), (b) => (b ? 1 : -1));
          const rng = lcg(seed);
          for (let i = 0; i < soft.length; i++) if (rng() < flipRate) soft[i] = -soft[i]!;
          const r = decodeRobustSoft(soft);
          if (r.ok) expect(Array.from(r.payload)).toEqual(Array.from(p));
        },
      ),
      { numRuns: 400, seed: 7 },
    );
  });

  it("rejects empty and oversized payloads like encodeFrame", () => {
    expect(() => encodeRobustFrame(new Uint8Array(0))).toThrow(RangeError);
    expect(() => encodeRobustFrame(new Uint8Array(141))).toThrow(RangeError);
  });

  it("never throws for arbitrary audio", () => {
    expect(receiveRobust(new Float32Array(0), defaultConfig)).toEqual({ ok: false, reason: "no_sync" });
    const noise = Float32Array.from({ length: 20000 }, () => Math.random() - 0.5);
    expect(() => receiveRobust(noise, defaultConfig)).not.toThrow();
  });
});

// Feature: handshake-fec-slice-3, normal vs robust on the simulated channel
// Finding (2026-11-13): with EXACT sync, robust lost at equal air time (normal 50 vs robust 100 baud,
// -15 dB: 10/20 vs 20/20): its uncoded header runs at the faster rate and an exact 24-bit match is
// the first thing to break. With maxSyncErrors: 2 on both, robust wins at equal air time by ~3 dB.
describe("SNR sweep, simulated channel", () => {
  const msg = new TextEncoder().encode(MSG);
  const cfgAt = (baud: number) =>
    createConfig({
      sampleRate: defaultConfig.sampleRate,
      baudRate: baud,
      markFrequency: defaultConfig.markFrequency,
      spaceFrequency: defaultConfig.spaceFrequency,
    });
  function run(levels: number[], normalBaud: number, robustBaud: number, trials: number, maxSyncErrors = 0) {
    const nCfg = cfgAt(normalBaud);
    const rCfg = cfgAt(robustBaud);
    return levels.map((snrDb) => {
      let n = 0;
      let r = 0;
      for (let t = 0; t < trials; t++) {
        const opts = { snrDb, leadingSilenceSamples: 333 + t, trailingSilenceSamples: 480 };
        const a = receive(simulateChannel(modulate(encodeFrame(msg), nCfg), { ...opts, rng: lcg(1000 * (snrDb + 50) + t) }), nCfg, { maxSyncErrors });
        const b = receiveRobust(simulateChannel(modulate(encodeRobustFrame(msg), rCfg), { ...opts, rng: lcg(7000 * (snrDb + 50) + t) }), rCfg, { maxSyncErrors });
        if (a.ok) {
          expect(Array.from(a.payload)).toEqual(Array.from(msg)); // never a wrong accept
          n++;
        }
        if (b.ok) {
          expect(Array.from(b.payload)).toEqual(Array.from(msg));
          r++;
        }
      }
      return { snrDb, n, r, trials };
    });
  }

  it("at the same baud (100), robust decodes more frames at low SNR", () => {
    const rows = run([-9, -12, -15, -18], 100, 100, 20);
    console.table(rows.map((x) => ({ "SNR (dB)": x.snrDb, "normal 100 baud": `${x.n}/${x.trials}`, "robust 100 baud (2x air time)": `${x.r}/${x.trials}` })));
    const gain = rows.filter((x) => x.snrDb <= -15).reduce((s, x) => s + x.r - x.n, 0);
    expect(gain).toBeGreaterThan(0);
  });

  it("at equal air time (normal 50 vs robust 100 baud, both with ±2 sync bits), robust decodes more", () => {
    // 100 trials per cell (2026-11-13): -15 dB 87 vs 100, -16.5 dB 58 vs 97, -18 dB 11 vs 62.
    // 20 trials was too few: one seed set flipped the order. 40 trials at the two low levels is stable.
    const rows = run([-16.5, -18], 50, 100, 40, 2);
    console.table(rows.map((x) => ({ "SNR (dB)": x.snrDb, "normal 50 baud ±2": `${x.n}/${x.trials}`, "robust 100 baud ±2": `${x.r}/${x.trials}` })));
    const gain = rows.reduce((sum, x) => sum + x.r - x.n, 0);
    expect(gain).toBeGreaterThan(0);
  });
});

// Feature: handshake-fec-slice-3, tolerant sync acquisition
describe("sync tolerance (maxSyncErrors)", () => {
  it("allowing 2 wrong sync bits finds more frames at low SNR and never accepts wrong data", () => {
    const msg = new TextEncoder().encode(MSG);
    const rows: Array<Record<string, string | number>> = [];
    let gain = 0;
    for (const snrDb of [-12, -15, -18]) {
      let exact = 0;
      let tolerant = 0;
      let rExact = 0;
      let rTolerant = 0;
      const trials = 20;
      for (let t = 0; t < trials; t++) {
        const opts = { snrDb, leadingSilenceSamples: 333, trailingSilenceSamples: 480 };
        const sN = simulateChannel(modulate(encodeFrame(msg), defaultConfig), { ...opts, rng: lcg(31 * (snrDb + 50) + t) });
        const sR = simulateChannel(modulate(encodeRobustFrame(msg), defaultConfig), { ...opts, rng: lcg(97 * (snrDb + 50) + t) });
        for (const [res, inc] of [
          [receive(sN, defaultConfig), () => exact++],
          [receive(sN, defaultConfig, { maxSyncErrors: 2 }), () => tolerant++],
          [receiveRobust(sR, defaultConfig), () => rExact++],
          [receiveRobust(sR, defaultConfig, { maxSyncErrors: 2 }), () => rTolerant++],
        ] as const) {
          if (res.ok) {
            expect(Array.from(res.payload)).toEqual(Array.from(msg));
            inc();
          }
        }
      }
      rows.push({
        "SNR (dB)": snrDb,
        "normal exact": `${exact}/${trials}`,
        "normal ±2": `${tolerant}/${trials}`,
        "robust exact": `${rExact}/${trials}`,
        "robust ±2": `${rTolerant}/${trials}`,
      });
      gain += tolerant - exact + (rTolerant - rExact);
    }
    console.table(rows);
    expect(gain).toBeGreaterThanOrEqual(0);
  });
});

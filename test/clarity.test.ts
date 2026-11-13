import { describe, it, expect } from "vitest";
import { toneClarity } from "../src/modem/clarity.js";
import { defaultConfig } from "../src/modem/config.js";
import { modulate } from "../src/modem/modulator.js";
import { encodeFrame } from "../src/protocol/frame.js";
import { simulateChannel } from "../src/channel/simulated.js";

function lcg(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(1664525, s) + 1013904223) >>> 0) / 0x100000000);
}

describe("toneClarity", () => {
  const clean = modulate(encodeFrame(new TextEncoder().encode("hello from the other side")), defaultConfig);

  it("is near 1 for a clean frame and 0 for silence", () => {
    expect(toneClarity(clean, defaultConfig)).toBeGreaterThan(0.95);
    expect(toneClarity(new Float32Array(48000), defaultConfig)).toBe(0);
  });

  it("falls monotonically as SNR drops", () => {
    const levels = [30, 10, 0, -10, -20];
    const scores = levels.map((snrDb) =>
      toneClarity(simulateChannel(clean, { snrDb, rng: lcg(7), gainMin: 1, gainMax: 1 }), defaultConfig),
    );
    for (let i = 1; i < scores.length; i++) expect(scores[i]!).toBeLessThan(scores[i - 1]!);
    expect(scores[scores.length - 1]!).toBeLessThan(0.1);
  });
});

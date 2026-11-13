/**
 * test/slice2.test.ts
 * Spec handshake-audio-slice-2: ring buffer, sample-rate config, BroadcastChannel path,
 * receiver polling (fake timers, injected fakes), and field-measurement CSV.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import * as fc from "fast-check";
import { RingBuffer } from "../src/util/ring-buffer.js";
import { configForSampleRate, rxBufferCapacity } from "../src/channel/rate-config.js";
import { broadcastSend, broadcastListen, type BroadcastResult } from "../src/channel/broadcast.js";
import { AudioRx, type RxNodeLike } from "../src/channel/audio-rx.js";
import { defaultConfig } from "../src/modem/config.js";
import { modulate } from "../src/modem/modulator.js";
import { encodeFrame } from "../src/protocol/frame.js";
import {
  CSV_COLUMNS,
  csvParse,
  csvSerialize,
  loadRows,
  saveRows,
  validateRow,
  type MeasurementRow,
} from "../src/ui/measurements.js";

// ── RingBuffer ───────────────────────────────────────────────────────────────
describe("RingBuffer", () => {
  it("rejects non-positive capacity", () => {
    expect(() => new RingBuffer(0)).toThrow(RangeError);
    expect(() => new RingBuffer(-1)).toThrow(RangeError);
  });

  // Feature: handshake-audio-slice-2, Properties 1–3: matches a reference model
  it("always holds the last `capacity` samples in order, for any write/clear sequence", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 64 }),
        fc.array(
          fc.oneof(
            fc.array(fc.integer({ min: -1000, max: 1000 }), { maxLength: 100 }).map((a) => ({ write: a })),
            fc.constant({ clear: true as const }),
          ),
          { maxLength: 30 },
        ),
        (cap, ops) => {
          const rb = new RingBuffer(cap);
          let model: number[] = [];
          for (const op of ops) {
            if ("clear" in op) {
              rb.clear();
              model = [];
            } else {
              rb.write(Float32Array.from(op.write));
              model = model.concat(op.write).slice(-cap);
            }
            expect(rb.length).toBe(model.length);
            expect(Array.from(rb.read())).toEqual(model);
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  it("read() does not consume", () => {
    const rb = new RingBuffer(4);
    rb.write(Float32Array.from([1, 2, 3]));
    expect(Array.from(rb.read())).toEqual([1, 2, 3]);
    expect(Array.from(rb.read())).toEqual([1, 2, 3]);
  });
});

// ── Sample-rate config ─────────────────────────────────────────────────────────
describe("configForSampleRate", () => {
  it("keeps tones and baud from defaultConfig and only changes the sample rate", () => {
    for (const rate of [44100, 48000]) {
      const warn = vi.fn();
      const c = configForSampleRate(rate, warn);
      expect(c.sampleRate).toBe(rate);
      expect(c.baudRate).toBe(defaultConfig.baudRate);
      expect(c.markFrequency).toBe(defaultConfig.markFrequency);
      expect(c.spaceFrequency).toBe(defaultConfig.spaceFrequency);
      expect(c.samplesPerSymbol).toBe(rate / defaultConfig.baudRate);
      expect(warn).not.toHaveBeenCalled();
    }
  });

  it("warns on a rate that does not divide evenly", () => {
    const warn = vi.fn();
    configForSampleRate(22050 + 1, warn);
    expect(warn).toHaveBeenCalledOnce();
  });

  it("sizes the receive buffer for the longest frame at the slowest rate plus one second", () => {
    const c = configForSampleRate(44100, () => {});
    // Longest case: a robust 140-byte frame at the slow rate (50 baud): 48 + 28 + 2×(1136 + 6) bits, byte-padded.
    const robustBits = Math.ceil((48 + 28 + 2 * (8 * 142 + 6)) / 8) * 8;
    expect(rxBufferCapacity(c)).toBe(Math.ceil(44100 * (robustBits / 50)) + 44100);
  });
});

// ── BroadcastChannel path ──────────────────────────────────────────────────────
function nextResult(
  channelName: string,
  opts: Partial<Parameters<typeof broadcastListen>[0]> = {},
): { result: Promise<BroadcastResult>; stop: () => void } {
  let stop = () => {};
  const result = new Promise<BroadcastResult>((resolve) => {
    stop = broadcastListen({ config: defaultConfig, channelName, ...opts }, resolve);
  });
  return { result, stop };
}

describe("BroadcastChannel path", () => {
  // Feature: handshake-audio-slice-2, Property 4: round-trip with no impairments
  it("delivers the exact payload between two channel instances", async () => {
    await fc.assert(
      fc.asyncProperty(fc.uint8Array({ minLength: 1, maxLength: 140 }), async (payload) => {
        const name = `t-${Math.random()}`;
        const { result, stop } = nextResult(name, {
          channelOptions: { snrDb: Infinity, clockDriftPpm: 0, gainMin: 1, gainMax: 1 },
        });
        broadcastSend(payload, { config: defaultConfig, channelName: name, now: () => 1234 });
        const r = await result;
        stop();
        expect(r.sentAt).toBe(1234);
        expect(r.result.ok).toBe(true);
        if (r.result.ok) expect(Array.from(r.result.payload)).toEqual(Array.from(payload));
      }),
      { numRuns: 30 },
    );
  });

  it("frames exactly once: decoded bytes are the payload, not a frame", async () => {
    const name = `t-${Math.random()}`;
    const payload = new TextEncoder().encode("地震");
    const { result, stop } = nextResult(name);
    broadcastSend(payload, { config: defaultConfig, channelName: name });
    const r = await result;
    stop();
    expect(r.result.ok && new TextDecoder().decode(r.result.payload)).toBe("地震");
  });

  it("never accepts wrong data at low SNR", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uint8Array({ minLength: 1, maxLength: 60 }),
        fc.constantFrom(-20, -15, -10, 0),
        async (payload, snrDb) => {
          const name = `t-${Math.random()}`;
          const { result, stop } = nextResult(name, { channelOptions: { snrDb } });
          broadcastSend(payload, { config: defaultConfig, channelName: name });
          const r = await result;
          stop();
          if (r.result.ok) expect(Array.from(r.result.payload)).toEqual(Array.from(payload));
        },
      ),
      { numRuns: 30, seed: 42 },
    );
  });

  it("stops delivering after unsubscribe", async () => {
    const name = `t-${Math.random()}`;
    const onResult = vi.fn();
    const stop = broadcastListen({ config: defaultConfig, channelName: name }, onResult);
    stop();
    broadcastSend(new Uint8Array([1]), { config: defaultConfig, channelName: name });
    await new Promise((r) => setTimeout(r, 50));
    expect(onResult).not.toHaveBeenCalled();
  });

  it("throws when BroadcastChannel is missing", () => {
    const saved = globalThis.BroadcastChannel;
    // @ts-expect-error simulate an old browser
    delete globalThis.BroadcastChannel;
    try {
      expect(() => broadcastSend(new Uint8Array([1]), { config: defaultConfig })).toThrow(
        "BroadcastChannel not supported",
      );
      expect(() => broadcastListen({ config: defaultConfig }, () => {})).toThrow(
        "BroadcastChannel not supported",
      );
    } finally {
      globalThis.BroadcastChannel = saved;
    }
  });
});

// ── AudioRx polling with injected fakes ──────────────────────────────────────────
function fakeEnv(settings: Record<string, boolean> = {
  echoCancellation: false,
  noiseSuppression: false,
  autoGainControl: false,
}) {
  const track = { stop: vi.fn(), getSettings: () => settings };
  const stream = { getAudioTracks: () => [track], getTracks: () => [track] } as unknown as MediaStream;
  const node: RxNodeLike & { disconnect: ReturnType<typeof vi.fn> } = {
    port: { onmessage: null },
    disconnect: vi.fn(),
  };
  const ctx = { sampleRate: 48000, state: "running", resume: vi.fn() } as unknown as AudioContext;
  const getUserMedia = vi.fn(async () => stream);
  return { track, stream, node, ctx, getUserMedia };
}

describe("AudioRx", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("asks for raw audio and reports which constraints the browser honored", async () => {
    const env = fakeEnv({ echoCancellation: false, noiseSuppression: true, autoGainControl: false });
    const rx = new AudioRx({
      getUserMedia: env.getUserMedia,
      isSecureContext: () => true,
      createCaptureNode: async () => env.node,
    });
    const report = vi.fn();
    rx.on("constraint-report", report);
    await rx.start(env.ctx);
    expect(env.getUserMedia).toHaveBeenCalledWith({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
    expect(report.mock.calls[0]![0].noiseSuppression).toEqual({
      requested: false,
      actual: true,
      honored: false,
    });
    expect(report.mock.calls[0]![0].echoCancellation.honored).toBe(true);
    rx.stop();
  });

  // Feature: handshake-audio-slice-2, Property 5: polling emits once on a decodable frame
  it("emits the payload once after 500 ms, then clears the buffer", async () => {
    vi.useFakeTimers();
    await fc.assert(
      fc.asyncProperty(
        fc.uint8Array({ minLength: 1, maxLength: 140 }),
        fc.integer({ min: 0, max: 2000 }),
        async (payload, lead) => {
          const env = fakeEnv();
          const rx = new AudioRx({
            getUserMedia: env.getUserMedia,
            isSecureContext: () => true,
            createCaptureNode: async () => env.node,
          });
          const got = vi.fn();
          rx.on("payload", got);
          await rx.start(env.ctx);
          const samples = modulate(encodeFrame(payload), defaultConfig);
          // Deliver like the worklet: silence, then the signal, in 128-sample blocks.
          const all = new Float32Array(lead + samples.length + 128);
          all.set(samples, lead);
          for (let i = 0; i < all.length; i += 128) {
            env.node.port.onmessage!({ data: { chunk: all.slice(i, i + 128) } });
          }
          vi.advanceTimersByTime(500);
          expect(got).toHaveBeenCalledTimes(1);
          expect(Array.from(got.mock.calls[0]![0].payload)).toEqual(Array.from(payload));
          expect(rx.buffer!.length).toBe(0);
          vi.advanceTimersByTime(500);
          expect(got).toHaveBeenCalledTimes(1);
          rx.stop();
        },
      ),
      { numRuns: 20 },
    );
  });

  // Feature: handshake-audio-slice-2, Property 6: no clear on a failed decode
  it("keeps buffering when nothing decodes", async () => {
    vi.useFakeTimers();
    const env = fakeEnv();
    const rx = new AudioRx({
      getUserMedia: env.getUserMedia,
      isSecureContext: () => true,
      createCaptureNode: async () => env.node,
    });
    const got = vi.fn();
    rx.on("payload", got);
    await rx.start(env.ctx);
    const noise = new Float32Array(4800).map(() => Math.random() * 2 - 1);
    env.node.port.onmessage!({ data: { chunk: noise } });
    vi.advanceTimersByTime(500);
    expect(got).not.toHaveBeenCalled();
    expect(rx.buffer!.length).toBe(4800);
    rx.stop();
  });

  it("throttles signal-level events", async () => {
    let t = 0;
    const env = fakeEnv();
    const rx = new AudioRx({
      getUserMedia: env.getUserMedia,
      isSecureContext: () => true,
      createCaptureNode: async () => env.node,
      now: () => t,
      levelIntervalMs: 80,
    });
    const level = vi.fn();
    rx.on("signal-level", level);
    await rx.start(env.ctx);
    for (let i = 0; i < 100; i++) {
      t = i * 2.7; // one render quantum at 48 kHz
      env.node.port.onmessage!({ data: { chunk: new Float32Array(128).fill(0.5) } });
    }
    // 100 blocks over ~270 ms → at most 4 events at an 80 ms gap
    expect(level.mock.calls.length).toBeLessThanOrEqual(4);
    expect(level.mock.calls[0]![0].rms).toBeCloseTo(0.5, 5);
    rx.stop();
  });

  it("decodes a transmission as soon as it ends, without waiting for a poll", async () => {
    let t = 0;
    const env = fakeEnv();
    const rx = new AudioRx({
      getUserMedia: env.getUserMedia,
      isSecureContext: () => true,
      createCaptureNode: async () => env.node,
      pollIntervalMs: 1e9, // the periodic poll never fires in this test
      now: () => t,
    });
    const got = vi.fn();
    rx.on("payload", got);
    await rx.start(env.ctx);
    const payload = new TextEncoder().encode("Stairwell 3F");
    const samples = modulate(encodeFrame(payload), defaultConfig);
    const all = new Float32Array(4800 + samples.length + 48000); // 0.1 s lead, 1 s of silence after
    all.set(samples, 4800);
    for (let i = 0; i < all.length; i += 128) {
      t += (128 / 48000) * 1000; // real time per render quantum
      env.node.port.onmessage!({ data: { chunk: all.slice(i, i + 128) } });
    }
    expect(got).toHaveBeenCalledTimes(1);
    expect(new TextDecoder().decode(got.mock.calls[0]![0].payload)).toBe("Stairwell 3F");
    rx.stop();
  });

  it("refuses to start outside a secure context, before asking for the mic", async () => {
    const env = fakeEnv();
    const rx = new AudioRx({ getUserMedia: env.getUserMedia, isSecureContext: () => false });
    const err = vi.fn();
    rx.on("error", err);
    await rx.start(env.ctx);
    expect(err).toHaveBeenCalledWith({ reason: "requires-https" });
    expect(env.getUserMedia).not.toHaveBeenCalled();
  });

  it("reports permission-denied", async () => {
    const rx = new AudioRx({
      isSecureContext: () => true,
      getUserMedia: async () => {
        throw Object.assign(new Error("denied"), { name: "NotAllowedError" });
      },
    });
    const err = vi.fn();
    rx.on("error", err);
    await rx.start(fakeEnv().ctx);
    expect(err).toHaveBeenCalledWith({ reason: "permission-denied" });
  });

  it("stop() halts polling, disconnects, and stops the mic", async () => {
    vi.useFakeTimers();
    const env = fakeEnv();
    const rx = new AudioRx({
      getUserMedia: env.getUserMedia,
      isSecureContext: () => true,
      createCaptureNode: async () => env.node,
    });
    await rx.start(env.ctx);
    rx.stop();
    expect(env.node.disconnect).toHaveBeenCalled();
    expect(env.track.stop).toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});

// ── Field measurements ─────────────────────────────────────────────────────────
const rowArb = fc.record(
  Object.fromEntries(CSV_COLUMNS.map((c) => [c, fc.string({ maxLength: 20 })])) as Record<
    (typeof CSV_COLUMNS)[number],
    fc.Arbitrary<string>
  >,
) as fc.Arbitrary<MeasurementRow>;

function validRow(over: Partial<MeasurementRow> = {}): MeasurementRow {
  return {
    date: "2026-11-13",
    tx_device: "Pixel 7",
    rx_device: "iPhone 13",
    environment: "quiet room",
    distance_m: "1",
    payload_bytes: "20",
    attempts: "10",
    successes: "9",
    notes: "",
    ...over,
  };
}

describe("field measurements", () => {
  // Feature: handshake-audio-slice-2, Property 7: CSV quoting round-trips
  it("CSV round-trips any field text, including commas, quotes and newlines", () => {
    fc.assert(
      fc.property(fc.array(rowArb, { maxLength: 10 }), (rows) => {
        const parsed = csvParse(csvSerialize(rows));
        expect(parsed[0]).toEqual([...CSV_COLUMNS]);
        expect(parsed.slice(1)).toEqual(rows.map((r) => CSV_COLUMNS.map((c) => r[c])));
      }),
      { numRuns: 200 },
    );
  });

  // Feature: handshake-audio-slice-2, Property 8: storage round-trip
  it("localStorage round-trip restores every row", () => {
    fc.assert(
      fc.property(fc.array(rowArb, { maxLength: 10 }), (rows) => {
        const mem = new Map<string, string>();
        const store = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) };
        saveRows(store, rows);
        expect(loadRows(store)).toEqual(rows);
      }),
    );
  });

  it("header only for no rows", () => {
    expect(csvSerialize([])).toBe(CSV_COLUMNS.join(",") + "\r\n");
  });

  it("rejects successes > attempts and empty required fields", () => {
    expect(validateRow(validRow())).toEqual({});
    expect(validateRow(validRow({ successes: "11" })).successes).toBeDefined();
    expect(validateRow(validRow({ tx_device: " " })).tx_device).toBe("required");
    expect(validateRow(validRow({ notes: "" }))).toEqual({});
    expect(validateRow(validRow({ payload_bytes: "141" })).payload_bytes).toBeDefined();
  });

  it("ignores corrupt storage", () => {
    expect(loadRows({ getItem: () => "{nope", setItem: () => {} })).toEqual([]);
  });
});

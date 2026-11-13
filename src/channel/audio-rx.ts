/**
 * src/channel/audio-rx.ts
 * Microphone receiver: AudioWorklet capture → ring buffer → receive() every 500 ms.
 * Web Audio and getUserMedia are reached only through injectable hooks, so the polling
 * logic is unit-testable without a browser.
 * Requirements (slice 2): 1.1, 1.4, 3.0–3.11, 8.2, 8.4
 */

import { receiveAny, type FrameMode } from "../modem/any-receiver.js";
import { robustAirSeconds } from "../protocol/robust-frame.js";
import type { ModemConfig } from "../modem/config.js";
import { RingBuffer } from "../util/ring-buffer.js";
import { configForSampleRate, rxBufferCapacity } from "./rate-config.js";
import { loadWorklet } from "./audio-tx.js";
import { toneClarity } from "../modem/clarity.js";

const DEFAULT_RX_WORKLET = new URL("./audio-rx-processor.js", import.meta.url).href;

const REQUESTED = {
  echoCancellation: false,
  noiseSuppression: false,
  autoGainControl: false,
} as const;

type ConstraintName = keyof typeof REQUESTED;

export type ConstraintReport = Record<
  ConstraintName,
  { requested: boolean; actual: boolean | undefined; honored: boolean }
>;

export interface RxEventMap {
  payload: { payload: Uint8Array; frameSeconds: number; mode: FrameMode };
  error: { reason: string };
  "constraint-report": ConstraintReport;
  /** rms of the latest block; clarity = tone share over the last 4 symbols, 0..1 */
  "signal-level": { rms: number; clarity: number };
}

/** The minimum of a worklet node this module needs. */
export interface RxNodeLike {
  port: { onmessage: ((e: { data: { chunk: Float32Array } }) => void) | null };
  disconnect(): void;
}

export interface AudioRxOptions {
  config?: ModemConfig;
  pollIntervalMs?: number;
  /** Minimum gap between signal-level events. */
  levelIntervalMs?: number;
  getUserMedia?: (c: MediaStreamConstraints) => Promise<MediaStream>;
  isSecureContext?: () => boolean;
  /** Creates the capture node and connects the mic stream to it (never to the speakers). */
  createCaptureNode?: (ctx: AudioContext, stream: MediaStream) => Promise<RxNodeLike>;
  now?: () => number;
}

type Listener<K extends keyof RxEventMap> = (data: RxEventMap[K]) => void;

export class AudioRx {
  private listeners = new Map<keyof RxEventMap, Set<(data: never) => void>>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private node: RxNodeLike | null = null;
  private stream: MediaStream | null = null;
  private running = false;
  private lastLevelAt = -Infinity;
  /** Exposed for tests and the UI. */
  buffer: RingBuffer | null = null;
  private recent: RingBuffer | null = null;
  config: ModemConfig | null = null;

  constructor(private readonly options: AudioRxOptions = {}) {}

  on<K extends keyof RxEventMap>(event: K, cb: Listener<K>): void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(cb as (data: never) => void);
  }

  off<K extends keyof RxEventMap>(event: K, cb: Listener<K>): void {
    this.listeners.get(event)?.delete(cb as (data: never) => void);
  }

  private emit<K extends keyof RxEventMap>(event: K, data: RxEventMap[K]): void {
    if (!this.running && event !== "error") return;
    this.listeners.get(event)?.forEach((cb) => (cb as Listener<K>)(data));
  }

  async start(ctx: AudioContext): Promise<void> {
    const o = this.options;
    const secure = o.isSecureContext ? o.isSecureContext() : globalThis.isSecureContext !== false;
    if (!secure) {
      this.emit("error", { reason: "requires-https" });
      return;
    }

    const gum =
      o.getUserMedia ?? ((c: MediaStreamConstraints) => navigator.mediaDevices.getUserMedia(c));
    let stream: MediaStream;
    try {
      stream = await gum({ audio: { ...REQUESTED } });
    } catch (err) {
      const name = (err as { name?: string }).name;
      this.emit("error", {
        reason: name === "NotAllowedError" ? "permission-denied" : String((err as Error).message ?? err),
      });
      return;
    }
    this.stream = stream;
    this.running = true;

    const track = stream.getAudioTracks()[0];
    const settings = (track?.getSettings?.() ?? {}) as Partial<Record<ConstraintName, boolean>>;
    const report = {} as ConstraintReport;
    for (const k of Object.keys(REQUESTED) as ConstraintName[]) {
      const actual = settings[k];
      report[k] = { requested: REQUESTED[k], actual, honored: actual === REQUESTED[k] };
    }
    this.emit("constraint-report", report);

    if (ctx.state === "suspended") await ctx.resume();
    this.config = o.config ?? configForSampleRate(ctx.sampleRate);
    this.buffer = new RingBuffer(rxBufferCapacity(this.config));
    this.recent = new RingBuffer(this.config.samplesPerSymbol * 4);

    const create = o.createCaptureNode ?? defaultCaptureNode;
    this.node = await create(ctx, stream);
    this.node.port.onmessage = ({ data }) => this.onChunk(data.chunk);

    this.timer = setInterval(() => this.poll(), o.pollIntervalMs ?? 500);
  }

  /** Feeds captured samples in; public so tests and alternative sources can use it. */
  onChunk(chunk: Float32Array): void {
    if (!this.running || !this.buffer) return;
    this.buffer.write(chunk);
    this.recent?.write(chunk);
    const now = (this.options.now ?? (() => performance.now()))();
    if (now - this.lastLevelAt >= (this.options.levelIntervalMs ?? 80)) {
      this.lastLevelAt = now;
      let sum = 0;
      for (let i = 0; i < chunk.length; i++) sum += chunk[i]! * chunk[i]!;
      const clarity = this.recent && this.config ? toneClarity(this.recent.read(), this.config) : 0;
      this.emit("signal-level", { rms: Math.sqrt(sum / Math.max(1, chunk.length)), clarity });
    }
  }

  /** One decode attempt over everything buffered. */
  poll(): void {
    if (!this.running || !this.buffer || !this.config) return;
    if (this.buffer.length === 0) return;
    const { result, mode } = receiveAny(this.buffer.read(), this.config);
    if (result.ok) {
      const n = result.payload.length;
      this.emit("payload", {
        payload: result.payload,
        frameSeconds: mode === "robust" ? robustAirSeconds(n, this.config) : ((n + 9) * 8) / this.config.baudRate,
        mode,
      });
      this.buffer.clear();
    }
  }

  stop(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    if (this.node) {
      this.node.port.onmessage = null;
      this.node.disconnect();
    }
    this.node = null;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.running = false;
  }
}

async function defaultCaptureNode(ctx: AudioContext, stream: MediaStream): Promise<RxNodeLike> {
  await loadWorklet(ctx, DEFAULT_RX_WORKLET);
  const source = ctx.createMediaStreamSource(stream);
  const node = new AudioWorkletNode(ctx, "handshake-rx", {
    numberOfInputs: 1,
    numberOfOutputs: 0,
    channelCount: 1,
    channelCountMode: "explicit",
  });
  source.connect(node); // not connected to ctx.destination: the mic must not play back
  return {
    port: node.port as unknown as RxNodeLike["port"],
    disconnect: () => {
      source.disconnect();
      node.disconnect();
    },
  };
}

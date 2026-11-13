/**
 * src/channel/broadcast.ts
 * Simulated two-tab path: tab A modulates and posts samples over BroadcastChannel;
 * tab B applies simulateChannel() impairments and runs receive().
 * Frames exactly once: callers pass the raw payload, never an encoded frame.
 * Requirements (slice 2): 5.1–5.6
 */

import { encodeFrame, type DecodeResult } from "../protocol/frame.js";
import { modulate } from "../modem/modulator.js";
import { receive } from "../modem/receiver.js";
import { toneClarity } from "../modem/clarity.js";
import { simulateChannel, type ChannelOptions } from "./simulated.js";
import type { ModemConfig } from "../modem/config.js";

export const DEFAULT_CHANNEL_NAME = "handshake";

export interface BroadcastSendOptions {
  config: ModemConfig;
  channelName?: string;
  /** Wall clock, injectable for tests. */
  now?: () => number;
}

export interface BroadcastListenOptions {
  config: ModemConfig;
  channelOptions?: ChannelOptions;
  channelName?: string;
}

export interface BroadcastResult {
  result: DecodeResult;
  /** Date.now() on the sender when the message was posted (comparable across tabs). */
  sentAt: number;
  /** Seconds the same frame would take as real audio. */
  audioSeconds: number;
  /** Tone share of the impaired samples this tab actually decoded, 0..1. */
  clarity: number;
}

interface WireMessage {
  samples: ArrayBuffer;
  sentAt: number;
}

function requireBroadcastChannel(): void {
  if (typeof BroadcastChannel === "undefined") {
    throw new Error("BroadcastChannel not supported");
  }
}

export function broadcastSend(payload: Uint8Array, options: BroadcastSendOptions): number {
  requireBroadcastChannel();
  const samples = modulate(encodeFrame(payload), options.config);
  const channel = new BroadcastChannel(options.channelName ?? DEFAULT_CHANNEL_NAME);
  const msg: WireMessage = { samples: samples.buffer as ArrayBuffer, sentAt: (options.now ?? Date.now)() };
  channel.postMessage(msg);
  channel.close();
  return samples.length / options.config.sampleRate;
}

/** Returns an unsubscribe function that stops listening and closes the channel. */
export function broadcastListen(
  options: BroadcastListenOptions,
  onResult: (r: BroadcastResult) => void,
): () => void {
  requireBroadcastChannel();
  const channel = new BroadcastChannel(options.channelName ?? DEFAULT_CHANNEL_NAME);
  let active = true;
  channel.onmessage = (e: MessageEvent<WireMessage>) => {
    if (!active) return;
    const samples = new Float32Array(e.data.samples);
    const impaired = simulateChannel(samples, options.channelOptions ?? {});
    onResult({
      result: receive(impaired, options.config),
      sentAt: e.data.sentAt,
      audioSeconds: samples.length / options.config.sampleRate,
      clarity: toneClarity(impaired, options.config),
    });
  };
  return () => {
    active = false;
    channel.onmessage = null;
    channel.close();
  };
}

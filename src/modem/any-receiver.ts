/**
 * src/modem/any-receiver.ts
 * One entry point for listeners: tries a normal frame, then a robust (FEC) frame, both with a sync
 * search that tolerates a few wrong bits. Only the sender chooses the mode; the listener never has
 * to be told. Each attempt still has to pass its CRC, so trying both cannot turn noise into a message.
 */

import type { ModemConfig } from "./config.js";
import { receive } from "./receiver.js";
import { receiveRobust } from "../protocol/robust-frame.js";
import type { DecodeResult } from "../protocol/frame.js";

/** Wrong bits tolerated in the 24-bit sync pattern; see test/fec.test.ts "sync tolerance". */
export const SYNC_TOLERANCE = 2;

export type FrameMode = "normal" | "robust";

export interface AnyResult {
  result: DecodeResult;
  /** Which decoder produced `result` (the successful one, or the more informative failure). */
  mode: FrameMode;
  /** The rate it was decoded at. */
  config: ModemConfig;
}

function rank(r: DecodeResult): number {
  if (r.ok) return 3;
  return r.reason === "crc_mismatch" ? 2 : r.reason === "bad_length" ? 1 : 0;
}

function atRate(samples: Float32Array, config: ModemConfig): AnyResult {
  const opts = { maxSyncErrors: SYNC_TOLERANCE };
  const normal = receive(samples, config, opts);
  if (normal.ok) return { result: normal, mode: "normal", config };
  const robust = receiveRobust(samples, config, opts);
  if (robust.ok) return { result: robust, mode: "robust", config };
  return rank(robust) > rank(normal)
    ? { result: robust, mode: "robust", config }
    : { result: normal, mode: "normal", config };
}

/**
 * Tries every frame format at every given rate (fastest first) and returns the first success, or
 * the most informative failure. `configs` defaults to just `config`'s own rate.
 */
export function receiveAny(samples: Float32Array, config: ModemConfig, configs: ModemConfig[] = [config]): AnyResult {
  let best: AnyResult | null = null;
  for (const c of configs) {
    const r = atRate(samples, c);
    if (r.result.ok) return r;
    if (!best || rank(r.result) > rank(best.result)) best = r;
  }
  return best!;
}

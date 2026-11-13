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
}

function rank(r: DecodeResult): number {
  if (r.ok) return 3;
  return r.reason === "crc_mismatch" ? 2 : r.reason === "bad_length" ? 1 : 0;
}

export function receiveAny(samples: Float32Array, config: ModemConfig): AnyResult {
  const opts = { maxSyncErrors: SYNC_TOLERANCE };
  const normal = receive(samples, config, opts);
  if (normal.ok) return { result: normal, mode: "normal" };
  const robust = receiveRobust(samples, config, opts);
  if (robust.ok) return { result: robust, mode: "robust" };
  return rank(robust) > rank(normal) ? { result: robust, mode: "robust" } : { result: normal, mode: "normal" };
}

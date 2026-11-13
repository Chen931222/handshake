/**
 * src/modem/receiver.ts
 * Frame acquisition from an un-aligned sample stream.
 *
 * Strategy (Req 12):
 *   1. Try 8 evenly-spaced sample offsets within one symbol period.
 *   2. For each offset demodulate to raw bits (one Goertzel pass).
 *   3. Search for the 24-bit sync pattern (last preamble byte 0x55 + sync word 0x1234)
 *      at every bit position — this is bit-granularity search (Req 12.2).
 *   4. On each match, pack the bits from the sync word onward into bytes,
 *      prepend the fixed preamble, and call decodeFrame.
 *   5. Return the first ok:true result, or the most informative failure
 *      (crc_mismatch > bad_length > no_sync) across all attempts.
 *
 * Never throws for any Float32Array input, including empty (Req 12.5).
 * No Web Audio API (Req 12.6).
 */

import { type ModemConfig } from "./config.js";
import { demodulateBits } from "./demodulator.js";
import { decodeFrame, type DecodeResult } from "../protocol/frame.js";

// 24-bit pattern: last preamble byte [0x55] + sync word [0x12, 0x34]
// Stored as an array of 0/1 values, MSB-first per byte.
const SYNC_PATTERN_BITS: ReadonlyArray<number> = makeSyncPatternBits();

function makeSyncPatternBits(): number[] {
  const bytes = [0x55, 0x12, 0x34];
  const bits: number[] = [];
  for (const byte of bytes) {
    for (let shift = 7; shift >= 0; shift--) {
      bits.push((byte >>> shift) & 1);
    }
  }
  return bits;
}

const SYNC_LEN = SYNC_PATTERN_BITS.length; // 24

// Fixed preamble prepended before calling decodeFrame
const FRAME_PREAMBLE = new Uint8Array([0xaa, 0x55, 0xaa, 0x55]);

/** Rank of a failure reason: higher = more informative. */
function failureRank(r: "no_sync" | "bad_length" | "crc_mismatch"): number {
  if (r === "crc_mismatch") return 2;
  if (r === "bad_length")   return 1;
  return 0;
}

/**
 * Packs an array of 0/1 bits (MSB-first per byte) into a Uint8Array.
 * Partial trailing bits are discarded.
 */
function packBitsToBytes(bits: Uint8Array, startBit: number): Uint8Array {
  const available = bits.length - startBit;
  if (available <= 0) return new Uint8Array(0);
  const numBytes = Math.floor(available / 8);
  const out = new Uint8Array(numBytes);
  for (let b = 0; b < numBytes; b++) {
    let byte = 0;
    for (let i = 0; i < 8; i++) {
      byte = (byte << 1) | (bits[startBit + b * 8 + i] ?? 0);
    }
    out[b] = byte;
  }
  return out;
}

/**
 * Finds the first bit index >= startSearch where bits[i..i+SYNC_LEN] matches SYNC_PATTERN_BITS.
 * Returns -1 if not found.
 */
function findSyncBits(bits: Uint8Array, startSearch: number, maxErrors = 0): number {
  const limit = bits.length - SYNC_LEN;
  for (let i = startSearch; i <= limit; i++) {
    let errors = 0;
    for (let j = 0; j < SYNC_LEN; j++) {
      if (bits[i + j] !== SYNC_PATTERN_BITS[j] && ++errors > maxErrors) break;
    }
    if (errors <= maxErrors) return i;
  }
  return -1;
}

export interface ReceiveOptions {
  /**
   * Mismatched bits tolerated in the 24-bit sync pattern (default 0). On a noisy air channel an
   * exact match is the first thing to fail; a tolerant match only proposes a start position,
   * and the CRC still decides whether anything is accepted.
   */
  maxSyncErrors?: number;
}

/**
 * Receives a frame from an un-aligned sample stream.
 * Returns DecodeResult — never throws.
 */
export function receive(samples: Float32Array, config: ModemConfig, options: ReceiveOptions = {}): DecodeResult {
  if (samples.length === 0) {
    return { ok: false, reason: "no_sync" };
  }

  const { samplesPerSymbol } = config;

  // 8 evenly-spaced offsets within one symbol period (Req 12.3)
  const numOffsets = 8;
  let bestFailure: Extract<DecodeResult, { ok: false }> = { ok: false, reason: "no_sync" };

  for (let oi = 0; oi < numOffsets; oi++) {
    const offset = Math.round((oi * samplesPerSymbol) / numOffsets);
    if (offset >= samples.length) continue;

    // One Goertzel pass for this timing offset
    let bits: Uint8Array;
    try {
      bits = demodulateBits(samples.subarray(offset), config);
    } catch {
      continue;
    }

    // Search for the 24-bit sync pattern at every bit position
    let searchFrom = 0;
    while (true) {
      const syncBitPos = findSyncBits(bits, searchFrom, options.maxSyncErrors ?? 0);
      if (syncBitPos === -1) break;

      // The sync word [0x12, 0x34] starts 8 bits after the start of the 24-bit pattern
      // (the first 8 bits are the last preamble byte 0x55).
      // Pack everything from the sync word onward, prepend preamble, call decodeFrame.
      const syncWordBit = syncBitPos + 8;
      const payloadBytes = packBitsToBytes(bits, syncWordBit);

      // Build a byte stream that looks like a full frame to decodeFrame:
      // [preamble 4 bytes] + [packed bytes starting at sync word]
      const frameBytes = new Uint8Array(FRAME_PREAMBLE.length + payloadBytes.length);
      frameBytes.set(FRAME_PREAMBLE, 0);
      frameBytes.set(payloadBytes, FRAME_PREAMBLE.length);

      const result = decodeFrame(frameBytes);
      if (result.ok) return result;

      // Track most informative failure
      if (failureRank(result.reason) > failureRank(bestFailure.reason)) {
        bestFailure = result;
      }

      // Advance past this match to find other potential sync positions
      searchFrom = syncBitPos + 1;
    }
  }

  return bestFailure;
}

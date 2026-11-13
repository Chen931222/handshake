/**
 * src/protocol/robust-frame.ts
 * Robust mode (spec handshake-fec-slice-3). The header is unchanged and uncoded, so acquisition
 * works exactly as in normal mode; everything after it is convolutionally coded.
 *
 *   [preamble 0xAA 0x55 0xAA 0x55][sync 0x12 0x34]   uncoded, 48 bits
 *   [length byte]                                    FEC alone: 2 × (8 + 6) = 28 bits
 *   [payload][CRC-16 over length + payload]          FEC, then interleaved (16 columns)
 *   [zero pad to a whole byte]
 *
 * The length is coded on its own so the receiver can decode it first and know exactly how many
 * soft values the rest of the frame needs. The CRC is the same CRC-16/CCITT as normal mode.
 */

import { crc16, type DecodeResult } from "./frame.js";
import { bitsToBytes, bytesToBits, codedLength, deinterleave, fecDecode, fecEncode, interleave } from "./fec.js";
import { demodulateBits, demodulateSoft } from "../modem/demodulator.js";
import type { ModemConfig } from "../modem/config.js";

export const ROBUST_COLS = 16;
const HEADER = new Uint8Array([0xaa, 0x55, 0xaa, 0x55, 0x12, 0x34]);
const MAX_PAYLOAD = 140;
const LEN_CODED = codedLength(8); // 28

function dataBytes(payload: Uint8Array): Uint8Array {
  const crcIn = new Uint8Array(1 + payload.length);
  crcIn[0] = payload.length;
  crcIn.set(payload, 1);
  const crc = crc16(crcIn);
  const out = new Uint8Array(payload.length + 2);
  out.set(payload, 0);
  out[payload.length] = (crc >>> 8) & 0xff;
  out[payload.length + 1] = crc & 0xff;
  return out;
}

/** Bytes ready for modulate(). Throws RangeError for an empty or >140-byte payload, like encodeFrame. */
export function encodeRobustFrame(payload: Uint8Array): Uint8Array {
  if (payload.length === 0) throw new RangeError("encodeRobustFrame: payload must not be empty");
  if (payload.length > MAX_PAYLOAD) {
    throw new RangeError(`encodeRobustFrame: payload length ${payload.length} exceeds ${MAX_PAYLOAD} bytes`);
  }
  const lenCoded = fecEncode(bytesToBits(new Uint8Array([payload.length])));
  const dataCoded = interleave(fecEncode(bytesToBits(dataBytes(payload))), ROBUST_COLS);
  const bits = new Uint8Array(HEADER.length * 8 + lenCoded.length + dataCoded.length);
  bits.set(bytesToBits(HEADER), 0);
  bits.set(lenCoded, HEADER.length * 8);
  bits.set(dataCoded, HEADER.length * 8 + lenCoded.length);
  return bitsToBytes(bits);
}

/** Seconds of sound for a payload in robust mode at this config's baud. */
export function robustAirSeconds(payloadBytes: number, config: ModemConfig): number {
  const bits = HEADER.length * 8 + LEN_CODED + codedLength(8 * (payloadBytes + 2));
  return Math.ceil(bits / 8) * 8 / config.baudRate;
}

/**
 * Decodes the soft values that follow the sync word. Never throws.
 * On a CRC failure it reports the decoded (wrong) payload as `corrupt`, like decodeFrame.
 */
export function decodeRobustSoft(soft: Float32Array): DecodeResult {
  if (soft.length < LEN_CODED) return { ok: false, reason: "bad_length" };
  const lenBits = fecDecode(soft.slice(0, LEN_CODED));
  const length = bitsToBytes(lenBits)[0]!;
  if (length === 0 || length > MAX_PAYLOAD) return { ok: false, reason: "bad_length" };
  const need = codedLength(8 * (length + 2));
  if (soft.length < LEN_CODED + need) return { ok: false, reason: "bad_length" };
  const data = bitsToBytes(fecDecode(deinterleave(soft.slice(LEN_CODED, LEN_CODED + need), ROBUST_COLS)));
  const payload = data.subarray(0, length);
  const crcIn = new Uint8Array(1 + length);
  crcIn[0] = length;
  crcIn.set(payload, 1);
  const stored = (data[length]! << 8) | data[length + 1]!;
  if (crc16(crcIn) !== stored) return { ok: false, reason: "crc_mismatch", corrupt: payload.slice() };
  return { ok: true, payload: payload.slice() };
}

const SYNC_BITS = bytesToBits(new Uint8Array([0x55, 0x12, 0x34])); // last preamble byte + sync

function rank(r: DecodeResult): number {
  if (r.ok) return 3;
  return r.reason === "crc_mismatch" ? 2 : r.reason === "bad_length" ? 1 : 0;
}

/**
 * Robust receiver: same acquisition as receive() (8 timing offsets, bit-level sync search on hard
 * decisions), then soft-decision decoding of everything after the sync word. Never throws.
 */
export function receiveRobust(
  samples: Float32Array,
  config: ModemConfig,
  options: { maxSyncErrors?: number } = {},
): DecodeResult {
  const maxErr = options.maxSyncErrors ?? 0;
  let best: DecodeResult = { ok: false, reason: "no_sync" };
  if (samples.length === 0) return best;
  const sps = config.samplesPerSymbol;
  for (let oi = 0; oi < 8; oi++) {
    const offset = Math.round((oi * sps) / 8);
    if (offset >= samples.length) continue;
    const view = samples.subarray(offset);
    let hard: Uint8Array;
    let soft: Float32Array;
    try {
      hard = demodulateBits(view, config);
      soft = demodulateSoft(view, config);
    } catch {
      continue;
    }
    const limit = hard.length - SYNC_BITS.length;
    for (let k = 0; k <= limit; k++) {
      let errors = 0;
      for (let j = 0; j < SYNC_BITS.length; j++) {
        if (hard[k + j] !== SYNC_BITS[j] && ++errors > maxErr) break;
      }
      if (errors > maxErr) continue;
      const r = decodeRobustSoft(soft.subarray(k + SYNC_BITS.length));
      if (r.ok) return r;
      if (rank(r) > rank(best)) best = r;
    }
  }
  return best;
}

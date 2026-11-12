/**
 * src/protocol/frame.ts
 * Protocol framing: encodeFrame / decodeFrame with CRC-16/CCITT.
 *
 * Frame layout (minimum 10 bytes):
 *   [0xAA, 0x55, 0xAA, 0x55]   preamble (4 bytes)
 *   [0x12, 0x34]                sync word (2 bytes)
 *   [length]                    payload byte count 1–140 (1 byte)
 *   [payload…]                  n bytes
 *   [crc_hi, crc_lo]            CRC-16/CCITT over [length, ...payload] (2 bytes)
 *
 * Requirements: 5.1–5.6, 6.1–6.6
 */

export type FailureReason = "no_sync" | "bad_length" | "crc_mismatch";

export type DecodeResult =
  | { ok: true; payload: Uint8Array }
  | { ok: false; reason: FailureReason };

// Fixed frame constants
const PREAMBLE = new Uint8Array([0xaa, 0x55, 0xaa, 0x55]);
const SYNC_HI = 0x12;
const SYNC_LO = 0x34;
const MAX_PAYLOAD = 140;
// Minimum: 4 preamble + 2 sync + 1 length + 1 payload + 2 CRC = 10
const MIN_FRAME_SIZE = 10;

/**
 * CRC-16/CCITT (CRC-16/IBM-3740 / CRC-16/AUTOSAR)
 * Polynomial: 0x1021, initial value: 0xFFFF, no input/output reflection.
 */
export function crc16(data: Uint8Array): number {
  let crc = 0xffff;
  for (let i = 0; i < data.length; i++) {
    crc ^= (data[i]! << 8);
    for (let bit = 0; bit < 8; bit++) {
      if (crc & 0x8000) {
        crc = ((crc << 1) ^ 0x1021) & 0xffff;
      } else {
        crc = (crc << 1) & 0xffff;
      }
    }
  }
  return crc;
}

/**
 * Encodes a payload into a complete frame Uint8Array.
 * Throws RangeError if payload is empty or longer than 140 bytes.
 */
export function encodeFrame(payload: Uint8Array): Uint8Array {
  if (payload.length === 0) {
    throw new RangeError("encodeFrame: payload must not be empty");
  }
  if (payload.length > MAX_PAYLOAD) {
    throw new RangeError(
      `encodeFrame: payload length ${payload.length} exceeds maximum of ${MAX_PAYLOAD} bytes`,
    );
  }

  // CRC covers [length byte, ...payload]
  const crcInput = new Uint8Array(1 + payload.length);
  crcInput[0] = payload.length;
  crcInput.set(payload, 1);
  const crc = crc16(crcInput);

  // Assemble frame
  const frame = new Uint8Array(
    PREAMBLE.length + 2 + 1 + payload.length + 2,
  );
  let off = 0;
  frame.set(PREAMBLE, off);       off += PREAMBLE.length;
  frame[off++] = SYNC_HI;
  frame[off++] = SYNC_LO;
  frame[off++] = payload.length;
  frame.set(payload, off);        off += payload.length;
  frame[off++] = (crc >>> 8) & 0xff;
  frame[off++] = crc & 0xff;

  return frame;
}

/**
 * Decodes a byte stream into a payload.
 * Never throws — all errors are returned as { ok: false, reason }.
 */
export function decodeFrame(bytes: Uint8Array): DecodeResult {
  // Minimum frame size check (Req 6.2)
  if (bytes.length < MIN_FRAME_SIZE) {
    return { ok: false, reason: "no_sync" };
  }

  // Find first occurrence of sync word [0x12, 0x34]
  let syncIndex = -1;
  for (let i = 0; i <= bytes.length - 2; i++) {
    if (bytes[i] === SYNC_HI && bytes[i + 1] === SYNC_LO) {
      syncIndex = i;
      break;
    }
  }
  if (syncIndex === -1) {
    return { ok: false, reason: "no_sync" };
  }

  // Length byte immediately after sync word
  const lengthIndex = syncIndex + 2;
  if (lengthIndex >= bytes.length) {
    return { ok: false, reason: "no_sync" };
  }
  const length = bytes[lengthIndex]!;

  // Validate length (Req 6.3)
  if (length === 0 || length > MAX_PAYLOAD) {
    return { ok: false, reason: "bad_length" };
  }

  // Check we have enough bytes for payload + 2 CRC (Req 6.2a — truncated frame)
  const payloadStart = lengthIndex + 1;
  const payloadEnd = payloadStart + length;
  const crcEnd = payloadEnd + 2;
  if (crcEnd > bytes.length) {
    return { ok: false, reason: "bad_length" };
  }

  // CRC check (Req 6.4)
  const crcInput = new Uint8Array(1 + length);
  crcInput[0] = length;
  crcInput.set(bytes.subarray(payloadStart, payloadEnd), 1);
  const computedCrc = crc16(crcInput);
  const storedCrc = ((bytes[payloadEnd]! << 8) | bytes[payloadEnd + 1]!) >>> 0;

  if (computedCrc !== storedCrc) {
    return { ok: false, reason: "crc_mismatch" };
  }

  return { ok: true, payload: bytes.slice(payloadStart, payloadEnd) };
}

/**
 * src/protocol/fec.ts
 * Forward error correction for the robust mode (spec handshake-fec-slice-3).
 * - Rate-1/2 convolutional code, constraint length 7, generators 0o171 / 0o133 (the NASA/CCSDS pair).
 * - Soft-decision Viterbi decoder over 64 states, tail-terminated (6 zero tail bits).
 * - Block interleaver: write row by row, read column by column, so a burst of errors on the air
 *   lands on bits far apart in the code.
 * Bits are Uint8Array of 0/1. Soft values are Float32Array; positive means "1" (mark), negative "0"
 * (space), magnitude is confidence. Pure functions, no Web Audio.
 */

export const K = 7;
// The register keeps the newest bit in the lowest position, so the standard generators
// 0o171 / 0o133 (written with the newest tap as the most significant bit) are stored bit-reversed.
// The impulse-response test checks that the output is exactly the 171/133 code.
const reverse7 = (g: number) => {
  let r = 0;
  for (let i = 0; i < 7; i++) if (g & (1 << i)) r |= 1 << (6 - i);
  return r;
};
const G0 = reverse7(0o171); // 0o117
const G1 = reverse7(0o133); // 0o155
const STATES = 1 << (K - 1); // 64
const TAIL = K - 1; // 6

function parity(x: number): number {
  x ^= x >> 4;
  x ^= x >> 2;
  x ^= x >> 1;
  return x & 1;
}

// Output pair for (state, input bit): the 7-bit register is (state << 1) | bit.
const OUT0 = new Uint8Array(STATES * 2);
const OUT1 = new Uint8Array(STATES * 2);
for (let s = 0; s < STATES; s++) {
  for (let b = 0; b < 2; b++) {
    const reg = (s << 1) | b;
    OUT0[s * 2 + b] = parity(reg & G0);
    OUT1[s * 2 + b] = parity(reg & G1);
  }
}

/** Encodes N bits into 2 × (N + 6) bits, ending in the zero state. */
export function fecEncode(bits: Uint8Array): Uint8Array {
  const out = new Uint8Array(2 * (bits.length + TAIL));
  let s = 0;
  let o = 0;
  const n = bits.length + TAIL;
  for (let i = 0; i < n; i++) {
    const b = i < bits.length ? bits[i]! & 1 : 0;
    out[o++] = OUT0[s * 2 + b]!;
    out[o++] = OUT1[s * 2 + b]!;
    s = ((s << 1) | b) & (STATES - 1);
  }
  return out;
}

/** Coded length for N information bits. */
export function codedLength(infoBits: number): number {
  return 2 * (infoBits + TAIL);
}

/**
 * Soft-decision Viterbi. `soft` has 2 × (N + 6) values; returns the N information bits.
 * Branch metric is the correlation of the soft pair with the expected ±1 pair, which is
 * equivalent to minimum Euclidean distance. Throws RangeError on an odd or too-short input.
 */
export function fecDecode(soft: Float32Array): Uint8Array {
  if (soft.length % 2 !== 0 || soft.length < 2 * TAIL) {
    throw new RangeError(`fecDecode: soft length ${soft.length} is not 2 × (N + ${TAIL})`);
  }
  const steps = soft.length / 2;
  const NEG = -1e30;
  let metric = new Float64Array(STATES).fill(NEG);
  metric[0] = 0;
  let next = new Float64Array(STATES);
  // decisions[t * 64 + ns] = which predecessor won (0: ns >> 1, 1: (ns >> 1) | 32)
  const decisions = new Uint8Array(steps * STATES);

  for (let t = 0; t < steps; t++) {
    const r0 = soft[2 * t]!;
    const r1 = soft[2 * t + 1]!;
    next.fill(NEG);
    for (let ns = 0; ns < STATES; ns++) {
      const b = ns & 1;
      const pA = ns >> 1; // predecessor with top bit 0
      const pB = pA | (STATES >> 1); // predecessor with top bit 1
      const mA =
        metric[pA]! + (OUT0[pA * 2 + b] ? r0 : -r0) + (OUT1[pA * 2 + b] ? r1 : -r1);
      const mB =
        metric[pB]! + (OUT0[pB * 2 + b] ? r0 : -r0) + (OUT1[pB * 2 + b] ? r1 : -r1);
      if (mB > mA) {
        next[ns] = mB;
        decisions[t * STATES + ns] = 1;
      } else {
        next[ns] = mA;
      }
    }
    const tmp = metric;
    metric = next;
    next = tmp;
  }

  // Tail-terminated: trace back from state 0.
  const bits = new Uint8Array(steps);
  let s = 0;
  for (let t = steps - 1; t >= 0; t--) {
    bits[t] = s & 1;
    const top = decisions[t * STATES + s]!;
    s = (s >> 1) | (top ? STATES >> 1 : 0);
  }
  return bits.subarray(0, steps - TAIL).slice();
}

/** Row-by-row in, column-by-column out. Pads to a multiple of `cols` only internally. */
export function interleave<T extends Uint8Array | Float32Array>(data: T, cols: number): T {
  return permute(data, cols, false);
}

export function deinterleave<T extends Uint8Array | Float32Array>(data: T, cols: number): T {
  return permute(data, cols, true);
}

function permute<T extends Uint8Array | Float32Array>(data: T, cols: number, inverse: boolean): T {
  if (!Number.isInteger(cols) || cols < 1) throw new RangeError("interleave: cols must be ≥ 1");
  const n = data.length;
  const out = new (data.constructor as { new (n: number): T })(n);
  if (cols === 1 || n === 0) {
    out.set(data);
    return out;
  }
  const rows = Math.ceil(n / cols);
  // Order in which positions are read: column by column, skipping padding cells.
  let k = 0;
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) {
      const i = r * cols + c;
      if (i >= n) continue;
      if (inverse) out[i] = data[k++]!;
      else out[k++] = data[i]!;
    }
  }
  return out;
}

export function bytesToBits(bytes: Uint8Array): Uint8Array {
  const bits = new Uint8Array(bytes.length * 8);
  for (let i = 0; i < bytes.length; i++) for (let j = 0; j < 8; j++) bits[i * 8 + j] = (bytes[i]! >> (7 - j)) & 1;
  return bits;
}

export function bitsToBytes(bits: Uint8Array): Uint8Array {
  const out = new Uint8Array(Math.ceil(bits.length / 8));
  for (let i = 0; i < bits.length; i++) if (bits[i]) out[i >> 3] = (out[i >> 3] ?? 0) | (0x80 >> (i & 7));
  return out;
}

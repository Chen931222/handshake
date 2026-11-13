# Design Document: Handshake FEC Slice 3

## Overview

Slice 3 adds a rate-1/2 convolutional FEC layer with soft-decision Viterbi decoding and block interleaving to the Handshake audio modem. The goal is to survive the 16–19% BER observed in desktop speaker→USB mic tests at 100 baud, where every frame currently fails CRC. The design introduces four new components:

1. `src/protocol/fec.ts` — convolutional encoder, Viterbi decoder, block interleaver
2. `demodulateSoft` added to `src/modem/demodulator.ts` — per-symbol soft confidence output
3. `src/protocol/robust-frame.ts` — robust frame encoder/decoder built on the FEC layer
4. `test/fec.test.ts` and `test/slice3.test.ts` — property-based tests

Normal frames (`encodeFrame`/`decodeFrame`) and all existing module signatures are untouched.

---

## Architecture

### Module / File Structure

```
src/
  modem/
    config.ts          (unchanged) — ModemConfig, createConfig, defaultConfig
    demodulator.ts     (additive)  — adds demodulateSoft; existing exports unchanged
    modulator.ts       (unchanged)
    receiver.ts        (unchanged)
  protocol/
    frame.ts           (unchanged) — encodeFrame, decodeFrame, crc16, DecodeResult
    fec.ts             (new)       — fecEncode, fecDecode, interleave, deinterleave
    robust-frame.ts    (new)       — encodeRobustFrame, decodeRobustFrame
test/
  fec.test.ts          (new)       — FEC unit + property tests
  slice3.test.ts       (new)       — robust frame round-trip, safety, SNR sweep
```

### Layer Dependency Rules

```
robust-frame.ts
  └── fec.ts            (fecEncode, fecDecode, interleave, deinterleave)
  └── frame.ts          (crc16, DecodeResult — read-only import, no code changes)

demodulator.ts
  └── config.ts         (ModemConfig type only)

test/slice3.test.ts
  └── robust-frame.ts
  └── demodulator.ts    (demodulateSoft)
  └── modulator.ts      (modulate)
  └── channel/simulated.ts (simulateChannel)
  └── config.ts
```

No new npm packages. No circular dependencies introduced.

---

## Data Flow Diagrams

### Encode Path — Robust Frame

```
payload: Uint8Array (1–140 bytes)
    │
    ▼
┌─────────────────────────────────────────┐
│  Build inner data: [length(1B) ║        │
│  payload(1-140B) ║ crc16(2B)]           │
│  → 4–143 bytes = 32–1144 bits           │
└───────────────┬─────────────────────────┘
                │ unpackBits → 0/1 Uint8Array
                ▼
┌─────────────────────────────────────────┐
│  fecEncode(bits)                        │
│  Convolutional K=7, rate 1/2            │
│  Appends 6 zero tail bits               │
│  Output: 2×(N+6) coded bits             │
└───────────────┬─────────────────────────┘
                │
                ▼
┌─────────────────────────────────────────┐
│  interleave(codedBits, cols=16)         │
│  Write row-by-row, read col-by-col      │
│  Zero-pads to multiple of 16            │
└───────────────┬─────────────────────────┘
                │
                ▼
┌─────────────────────────────────────────┐
│  packBits (MSB-first per byte)          │
└───────────────┬─────────────────────────┘
                │
                ▼
┌─────────────────────────────────────────┐
│  Prepend frame header:                  │
│  [0xAA,0x55,0xAA,0x55, 0x12,0x34,0xFF] │
│  preamble(4) + sync(2) + mode(1)        │
└───────────────┬─────────────────────────┘
                │
                ▼
            Uint8Array → modulate() → Float32Array audio
```

### Decode Path — Robust Frame (Soft Decision)

```
Float32Array audio
    │
    ▼
demodulateSoft(samples, config)
    │  one (markEnergy − spaceEnergy) per symbol
    ▼
┌─────────────────────────────────────────┐
│  Scan soft samples for sync header:     │
│  hard-decision scan for preamble +      │
│  sync [0x12,0x34] + mode byte [0xFF]    │
└───────────────┬─────────────────────────┘
                │ slice soft bits after mode byte
                ▼
┌─────────────────────────────────────────┐
│  deinterleave soft values, cols=16      │
│  (map bit-index → soft-index via same   │
│   permutation as interleave)            │
└───────────────┬─────────────────────────┘
                │ Float32Array of soft pairs
                ▼
┌─────────────────────────────────────────┐
│  fecDecode(softBits)                    │
│  Viterbi over 64-state trellis          │
│  Returns N = M-6 information bits       │
└───────────────┬─────────────────────────┘
                │ Uint8Array of 0/1 bits
                ▼
┌─────────────────────────────────────────┐
│  packBits → [length(1B) ║               │
│  payload ║ crc_hi ║ crc_lo]             │
│  Verify CRC-16/CCITT over               │
│  [length ║ payload]                     │
└───────────────┬─────────────────────────┘
                │
           ok:true payload  OR  ok:false reason
```

### Decode Path — Hard Decision (decodeRobustFrame on bytes)

Same as above but starting from bytes instead of samples. Unpack bytes to hard bits, treat as soft ±1 (`bit===1 ? 1.0 : -1.0`), then follow the same pipeline.

---

## Components and Interfaces

### Component Summary

| Component | File | Role |
|---|---|---|
| FEC Codec | `src/protocol/fec.ts` | Convolutional encode/decode, block interleave/deinterleave |
| Soft Demodulator | `src/modem/demodulator.ts` | Adds `demodulateSoft`; existing exports unchanged |
| Robust Frame | `src/protocol/robust-frame.ts` | FEC-protected frame encode/decode |
| FEC Tests | `test/fec.test.ts` | Unit + property tests for fec.ts |
| Slice 3 Tests | `test/slice3.test.ts` | Round-trip, safety, SNR sweep tests |

### Exported Interfaces

```typescript
// src/protocol/fec.ts
export function fecEncode(bits: Uint8Array): Uint8Array;
export function fecDecode(softBits: Float32Array): Uint8Array;
export function interleave(bits: Uint8Array, cols: number): Uint8Array;
export function deinterleave(bits: Uint8Array, cols: number): Uint8Array;

// src/modem/demodulator.ts (new export, all existing exports unchanged)
export function demodulateSoft(samples: Float32Array, config: ModemConfig): Float32Array;

// src/protocol/robust-frame.ts
export function encodeRobustFrame(payload: Uint8Array): Uint8Array;
export function decodeRobustFrame(bytes: Uint8Array): DecodeResult;
```

---

## Data Models

### Bit Representation

Throughout the FEC layer, bits are represented as `Uint8Array` with one element per bit (value 0 or 1). Bytes are packed/unpacked MSB-first. The `packBits` and `unpackBits` helpers convert between the two representations.

```
Bytes:   [  0xB4   ] = 1011 0100
Bits:    [1, 0, 1, 1, 0, 1, 0, 0]  (index 0 = MSB)
```

### Soft Bit Representation

Soft bits are `Float32Array` values equal to `(markEnergy − spaceEnergy)`:
- Positive → mark (1) is more likely; magnitude = confidence
- Negative → space (0) is more likely; magnitude = confidence
- 0.0 → maximum uncertainty

The FEC decoder alternates pairs: `[soft_p0_t0, soft_p1_t0, soft_p0_t1, soft_p1_t1, …]`

### Shift Register State

The convolutional encoder state is a 7-bit integer `reg` where:
- bit 6 (MSB) = most recently inserted input bit
- bits 5..0 = prior 6 input bits (oldest at bit 0)

```
reg = [ b_t, b_{t-1}, b_{t-2}, b_{t-3}, b_{t-4}, b_{t-5}, b_{t-6} ]
        6      5         4         3         2         1         0
```

Generators applied as: `p0 = popcount(reg & 0x79) & 1`, `p1 = popcount(reg & 0x5B) & 1`  
(0x79 = 0b1111001 = 0o171, 0x5B = 0b1011011 = 0o133)

### Robust Frame Inner Data

```typescript
interface RobustInnerData {
  length: number;         // 1 byte: payload.length (0–140)
  payload: Uint8Array;    // 0–140 bytes
  crc: number;            // 2 bytes: CRC-16/CCITT over [length, ...payload]
}
// Total: 3 + payload.length bytes → (3 + payload.length) × 8 bits before FEC
```

### Viterbi Path Metric State

```typescript
// Forward pass state at each time step:
pathMetric: Float32Array(64)  // accumulated branch-metric cost per trellis state
decisions:  Uint8Array(M*64)  // decisions[t*64 + nextState] = surviving input bit
```

---

## Detailed Interface Specifications

### src/protocol/fec.ts

#### `fecEncode(bits: Uint8Array): Uint8Array`

Encodes N information bits using a rate-1/2 K=7 convolutional code.

**Shift register:** 7-bit integer `reg`, initialised to 0. For each input bit (including 6 appended zero tail bits):

```
reg = ((reg << 1) | bit) & 0x7F    // 7-bit window
p0 = popcount(reg & 0o171) & 1     // G0 = 1111001b = 0x79
p1 = popcount(reg & 0o133) & 1     // G1 = 1011011b = 0x5B
emit [p0, p1] into output array
```

`popcount(x)` = number of 1-bits in x. Implemented as: XOR reduction of bits (loop or lookup table).

**Output:** `Uint8Array` of exactly `2 × (N + 6)` elements, each 0 or 1. Order: `[p0_0, p1_0, p0_1, p1_1, …]` (interleaved pairs).

**Edge case:** N=0 → output is 12 zero bits (tail-only encoding, reg never leaves 0).

#### `fecDecode(softBits: Float32Array): Uint8Array`

Soft-decision Viterbi decoder. Input length must be even; if not, throws `RangeError("fecDecode: softBits length must be even")`.

**Trellis:** 64 states (bits 0–5 of the K=7 shift register). Time step `t` corresponds to coded pair `[softBits[2t], softBits[2t+1]]`.

**Initialisation:** pathMetric[0] = 0, pathMetric[1..63] = +Infinity. Total time steps M = `softBits.length / 2`.

**Branch metric** for state transition (state `s`, input bit `b`):
```
reg = ((s << 1) | b) & 0x7F
c0 = popcount(reg & 0o171) & 1     // expected coded bit 0
c1 = popcount(reg & 0o133) & 1     // expected coded bit 1
expected_s0 = c0 ? 1.0 : -1.0
expected_s1 = c1 ? 1.0 : -1.0
bm = (r0 - expected_s0)² + (r1 - expected_s1)²
   where r0 = softBits[2t], r1 = softBits[2t+1]
nextState = (reg >> 1) & 0x3F      // drop the new input bit from MSB
```

**Survivor storage:** `decisions[t][s]` = the input bit (0 or 1) that produced the surviving predecessor at state `s` at time `t`. Stored as a flat `Uint8Array` of length `M × 64` with row-major layout: `decisions[t*64 + s]`.

**Forward pass:**

```
for t in 0..M-1:
  newMetric[0..63] = +Infinity
  for s in 0..63:
    if pathMetric[s] == +Infinity: skip
    for b in [0, 1]:
      compute reg, c0, c1, nextState, bm
      candidate = pathMetric[s] + bm
      if candidate < newMetric[nextState]:
        newMetric[nextState] = candidate
        decisions[t*64 + nextState] = b
  pathMetric = newMetric
```

**Traceback:** Start from state 0 at time M (tail-terminated). Walk backwards M steps collecting `decisions[t*64 + state]` and updating `state = prevState(state, decision)`:

```
prevState(nextState, b) = (nextState >> 1) | (b << 5)
// Because nextState = (reg >> 1) & 0x3F
// and reg = (s << 1) | b, so s = (nextState >> ?) ... 
// More directly: at step t we know nextState and b
//   reg = (s_prev << 1 | b) & 0x7F  =>  s_prev = reg >> 1 = (nextState << 1 | b_at_top)
// Actually: nextState = (reg >> 1) & 0x3F = ((s_prev << 1 | b) >> 1) & 0x3F = s_prev & 0x3F = s_prev
// Wait: reg = ((s_prev << 1) | b) & 0x7F; nextState = (reg >> 1) & 0x3F = s_prev
// So prevState = nextState at each step? No —
// nextState = ((s_prev << 1 | b) >> 1) & 0x3F = s_prev (the lower 6 bits of s_prev)
// But s_prev IS already 6 bits, so prevState = s_prev = ((nextState >> ?) | ?)
```

Correct traceback: since `nextState = (reg >> 1) & 0x3F` and `reg = (s_prev << 1 | b) & 0x7F`:

```
nextState bits [5:0] = reg bits [6:1] = s_prev bits [5:0] shifted left by 1
Wait, reg = s_prev[5..0] shifted left by 1 and bit 0 = b:
  reg[6] = s_prev[5]
  reg[5..1] = s_prev[4..0]
  reg[0] = b
nextState = reg[6..1] = s_prev[5..0] >> no...
nextState[5..0] = reg[6..1] = { s_prev[5], s_prev[4], s_prev[3], s_prev[2], s_prev[1], s_prev[0] }[5..1]
  = { s_prev[5], s_prev[4], s_prev[3], s_prev[2], s_prev[1] } padded with reg[1] = s_prev[0]
```

Simplified: `nextState = (s_prev >> 0) & 0x1F | (bit5_of_reg << 5)` — this gets complex. Use the direct formula:

```
prevState(nextState, b) = ((nextState >> 1) | (b << 5)) & 0x3F
```

Explanation: `nextState` = upper 6 bits of `reg` (bits [6:1]). To recover `s_prev` = bits [5:0] of `reg` shifted right one was `s_prev`... The simplest correct form:

Since `nextState = ((s_prev << 1 | b) >> 1) & 0x3F`, this equals `s_prev` when `s_prev < 64` and the shift is arithmetic. Actually `(s_prev << 1 | b) >> 1 = s_prev` only if no overflow — but with 6-bit register that's not right for 7-bit reg. Let me use the unambiguous bit layout:

```
7-bit reg after update: [ s_prev[5], s_prev[4], s_prev[3], s_prev[2], s_prev[1], s_prev[0], b ]
                           bit6       bit5       bit4       bit3       bit2       bit1      bit0
nextState = reg[6..1] >> 0 = bits 6..1 = [ s_prev[5..0] ]  = s_prev
```

Therefore `nextState === s_prev`. Traceback trivially gives `prevState = nextState` and the surviving input bit `b` at each step. The traceback state does not change — only the bits are collected.

**Output:** Collect M bits in reverse order, return first `M − 6` bits (drop the 6 tail steps). Return as `Uint8Array`.

**Edge case:** If `softBits.length` is odd, throw `RangeError("fecDecode: softBits length must be even")`.

#### `interleave(bits: Uint8Array, cols: number): Uint8Array`

```
rows = Math.ceil(bits.length / cols)
padded = new Uint8Array(rows * cols)   // zero-padded
padded.set(bits)
output: for c in 0..cols-1, r in 0..rows-1: output[c*rows + r] = padded[r*cols + c]
```

Output length = `rows × cols` (may be longer than input by up to `cols−1` bits due to padding).

#### `deinterleave(bits: Uint8Array, cols: number): Uint8Array`

Inverse: write column-by-column into matrix, read row-by-row, then truncate to original length.

```
rows = bits.length / cols   // bits.length must be multiple of cols (caller's responsibility)
matrix[r][c] = bits[c*rows + r]
output = matrix read row-by-row, truncated to originalLength
```

The `originalLength` is not stored — the caller must pass the right length. In practice, `deinterleave` returns `rows × cols` bits; the caller truncates after FEC decode (since FEC output length is known from `softBits.length`).

---

### src/modem/demodulator.ts — additive export

#### `demodulateSoft(samples: Float32Array, config: ModemConfig): Float32Array`

```typescript
export function demodulateSoft(samples: Float32Array, config: ModemConfig): Float32Array {
  validateConfig(config);
  const { sampleRate, markFrequency, spaceFrequency, samplesPerSymbol } = config;
  const numSymbols = Math.floor(samples.length / samplesPerSymbol);
  const out = new Float32Array(numSymbols);
  for (let i = 0; i < numSymbols; i++) {
    const offset = i * samplesPerSymbol;
    const eMark  = goertzelEnergy(samples, offset, samplesPerSymbol, markFrequency, sampleRate);
    const eSpace = goertzelEnergy(samples, offset, samplesPerSymbol, spaceFrequency, sampleRate);
    out[i] = eMark - eSpace;
  }
  return out;
}
```

`goertzelEnergy` is the existing private function — no signature change needed. This function reuses it identically to `demodulateBits`. Values are unbounded positive/negative floats; sign indicates which tone dominates.

---

### src/protocol/robust-frame.ts

#### Wire Format

```
Offset  Length  Content
0       4       Preamble: [0xAA, 0x55, 0xAA, 0x55]
4       2       Sync word: [0x12, 0x34]  (identical to normal frame)
6       1       Mode byte: [0xFF]  (normal frame length byte is 1–140, never 0xFF)
7       N       FEC blob: packBits(interleave(fecEncode(unpackBits(innerData)), 16))
```

`innerData = [length(1), payload(0–140), crc_hi(1), crc_lo(1)]`  
CRC covers `[length ║ payload]` using `crc16` from `frame.ts`.

**Bit sizes:**
- innerData bytes: 2+len (len = payload length, 0–140) → 1+len+2 = 3+len bytes
  Wait — innerData is [length(1) + payload(len) + crc(2)] = (3+len) bytes = (3+len)×8 bits
- After fecEncode: 2×((3+len)×8 + 6) coded bits
- After interleave (cols=16): ceil(coded_bits / 16) × 16 bits (zero-padded)
- After packBits: ceil(interleaved_bits / 8) bytes

For len=0: innerData=3 bytes=24 bits; coded=2×30=60 bits; interleaved=64 bits (padded to multiple of 16); packed=8 bytes.  
For len=140: innerData=143 bytes=1144 bits; coded=2×1150=2300 bits; interleaved=2304 bits; packed=288 bytes.

#### `encodeRobustFrame(payload: Uint8Array): Uint8Array`

```typescript
export function encodeRobustFrame(payload: Uint8Array): Uint8Array {
  if (payload.length > 140) throw new RangeError("encodeRobustFrame: payload exceeds 140 bytes");

  // 1. Build inner data bytes
  const crcInput = new Uint8Array(1 + payload.length);
  crcInput[0] = payload.length;
  crcInput.set(payload, 1);
  const crc = crc16(crcInput);                              // from frame.ts
  const inner = new Uint8Array(1 + payload.length + 2);
  inner[0] = payload.length;
  inner.set(payload, 1);
  inner[inner.length - 2] = (crc >>> 8) & 0xFF;
  inner[inner.length - 1] = crc & 0xFF;

  // 2. FEC + interleave + pack
  const bits       = unpackBits(inner);                    // local helper
  const coded      = fecEncode(bits);
  const interleaved = interleave(coded, 16);
  const blob       = packBits(interleaved);                 // local helper

  // 3. Assemble frame
  const frame = new Uint8Array(4 + 2 + 1 + blob.length);
  frame.set([0xAA, 0x55, 0xAA, 0x55], 0);
  frame[4] = 0x12; frame[5] = 0x34;
  frame[6] = 0xFF;
  frame.set(blob, 7);
  return frame;
}
```

#### `decodeRobustFrame(bytes: Uint8Array): DecodeResult`

Hard-decision decode (input is packed bytes, not soft samples).

```typescript
export function decodeRobustFrame(bytes: Uint8Array): DecodeResult {
  // 1. Find sync word [0x12, 0x34]
  let syncIdx = -1;
  for (let i = 0; i <= bytes.length - 2; i++) {
    if (bytes[i] === 0x12 && bytes[i+1] === 0x34) { syncIdx = i; break; }
  }
  if (syncIdx === -1) return { ok: false, reason: "no_sync" };

  // 2. Check mode byte
  const modeIdx = syncIdx + 2;
  if (modeIdx >= bytes.length) return { ok: false, reason: "no_sync" };
  if (bytes[modeIdx] !== 0xFF) return { ok: false, reason: "no_sync" };

  // 3. Extract FEC blob and unpack to soft ±1
  const blob = bytes.subarray(modeIdx + 1);
  if (blob.length === 0) return { ok: false, reason: "bad_length" };
  const hardBits   = unpackBits(blob);
  const softBits   = new Float32Array(hardBits.length);
  for (let i = 0; i < hardBits.length; i++) softBits[i] = hardBits[i] === 1 ? 1.0 : -1.0;

  // 4. Deinterleave
  const deinterleaved = deinterleaveSoft(softBits, 16);

  // 5. Viterbi decode
  let decoded: Uint8Array;
  try { decoded = fecDecode(deinterleaved); }
  catch { return { ok: false, reason: "bad_length" }; }

  // 6. Pack to bytes
  const inner = packBits(decoded);
  if (inner.length < 3) return { ok: false, reason: "bad_length" };

  // 7. Parse inner data
  const length = inner[0]!;
  if (inner.length < 1 + length + 2) return { ok: false, reason: "bad_length" };

  const payload = inner.slice(1, 1 + length);
  const crcInput = new Uint8Array(1 + length);
  crcInput[0] = length;
  crcInput.set(payload, 1);
  const computedCrc = crc16(crcInput);
  const storedCrc = ((inner[1 + length]! << 8) | inner[1 + length + 1]!) >>> 0;

  if (computedCrc !== storedCrc) return { ok: false, reason: "crc_mismatch" };
  return { ok: true, payload };
}
```

#### Local helpers (not exported)

```typescript
// Unpack bytes to 0/1 bit array (MSB-first per byte)
function unpackBits(bytes: Uint8Array): Uint8Array;

// Deinterleave Float32Array treating each index as a soft "bit"
// Applies same column-major → row-major permutation as deinterleave
function deinterleaveSoft(soft: Float32Array, cols: number): Float32Array;
```

`deinterleaveSoft` mirrors `deinterleave` but operates on Float32Array: same index permutation, same zero-padding behavior.

---

## Equal Air Time Principle

Normal mode: 100 baud, N payload bits → T seconds of audio.  
Robust mode: same N payload bits → after rate-1/2 FEC → 2N coded bits → at 50 baud → same T seconds.

The SNR sweep test must set `baudRate: 50` (and recalculate `samplesPerSymbol` via `createConfig`) for the robust path, keeping all other params identical to normal mode. Both paths produce the same number of audio samples.

---

## Error Handling

| Condition | Function | Return |
|---|---|---|
| Sync [0x12,0x34] not found | decodeRobustFrame | `{ok:false, reason:"no_sync"}` |
| Mode byte after sync ≠ 0xFF | decodeRobustFrame | `{ok:false, reason:"no_sync"}` |
| FEC blob empty | decodeRobustFrame | `{ok:false, reason:"bad_length"}` |
| fecDecode throws (odd length) | decodeRobustFrame | `{ok:false, reason:"bad_length"}` |
| Packed inner data < 3 bytes | decodeRobustFrame | `{ok:false, reason:"bad_length"}` |
| Inner length field inconsistent | decodeRobustFrame | `{ok:false, reason:"bad_length"}` |
| CRC mismatch after Viterbi | decodeRobustFrame | `{ok:false, reason:"crc_mismatch"}` |
| softBits.length is odd | fecDecode | throws RangeError |
| payload > 140 bytes | encodeRobustFrame | throws RangeError |
| mark energy == space energy | demodulateSoft | returns 0.0 |

---

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system — a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: FEC encoder output length

*For any* bit array of length N, `fecEncode(bits).length` equals exactly `2 × (N + 6)`.

**Validates: Requirements 1.2**

### Property 2: FEC encoder output is binary

*For any* bit array `bits`, every element of `fecEncode(bits)` is either 0 or 1.

**Validates: Requirements 1.4**

### Property 3: FEC decoder output length

*For any* `Float32Array` of even length `2M` where `M >= 6`, `fecDecode(softBits).length` equals `M − 6`.

**Validates: Requirements 2.2**

### Property 4: FEC round-trip on clean channel

*For any* bit array `bits` of length 0–256, mapping the encoded hard bits to soft values (`1 → 1.0`, `0 → -1.0`) and decoding recovers the original bits exactly:  
`fecDecode(toSoft(fecEncode(bits))) === bits`.

**Validates: Requirements 2.1, 2.3, 8.1, 8.2, 8.3, 8.4**

### Property 5: Interleaver round-trip

*For any* bit array `bits` and column count `cols` from {1, 2, 4, 8, 16, 32},  
`deinterleave(interleave(bits, cols), cols)` returns an array equal to `bits`.

**Validates: Requirements 3.1, 3.2, 3.3, 9.1, 9.2**

### Property 6: Soft demodulator sign agreement

*For any* pure mark-frequency tone signal generated with `modulate`, each element of `demodulateSoft(samples, config)` is strictly positive; for a pure space-frequency tone, each element is strictly negative; for a zero-amplitude signal, each element is 0.0.

**Validates: Requirements 4.2, 4.5**

### Property 7: Robust frame starts with correct header

*For any* payload of length 0–140 bytes, the first 7 bytes of `encodeRobustFrame(payload)` are `[0xAA, 0x55, 0xAA, 0x55, 0x12, 0x34, 0xFF]`.

**Validates: Requirements 5.2, 5.3**

### Property 8: Robust frame round-trip on clean channel

*For any* payload byte array `p` of length 0–64 bytes,  
`decodeRobustFrame(encodeRobustFrame(p))` returns `{ ok: true, payload: p }`.

**Validates: Requirements 5.1, 5.3, 5.4, 5.5, 6.1, 6.2, 6.5, 6.6, 10.1, 10.2**

### Property 9: No wrong accepts under noise (CRC safety)

*For any* payload and *any* bit-flip noise pattern applied to the encoded frame bytes, if `decodeRobustFrame` returns `{ ok: true, payload: recovered }` then `recovered` exactly equals the original payload. A result with `ok: true` and a different payload is a test failure.

**Validates: Requirements 6.3, 11.1, 11.2, 11.3**

### Property 10: FEC gain at 10% BER

*For any* fixed payload, transmitting in robust mode (50 baud) versus normal mode (100 baud) at equal air time and 10% simulated BER, the robust-mode frame decode success rate exceeds the normal-mode success rate by at least 20 percentage points (measured over ≥100 trials).

**Validates: Requirements 12.1, 12.2, 12.3, 12.4**

---

## Testing Strategy

### test/fec.test.ts

**Unit tests:**
- Known-vector test: single all-zero input → 12 all-zero output bits (tail-only)
- Known-vector test: `[1]` → verify exact 14-bit output matches pre-computed value for G0=0o171, G1=0o133
- Viterbi corrects one flipped bit in clean encoding
- `fecDecode` with odd-length input throws RangeError
- `interleave([...], 1)` returns copy of input unchanged
- `interleave` output length is a multiple of `cols`

**Property tests (fast-check):**
- Property 1: output length = 2×(N+6) for all lengths 0–256
- Property 2: all output elements in {0,1}
- Property 3: fecDecode output length = M-6 for all even-length inputs
- Property 4: FEC round-trip (clean channel), 0–256 bits, ≥100 runs
- Property 5: interleaver round-trip for all sizes and cols ∈ {1,2,4,8,16,32}, ≥100 runs

### test/slice3.test.ts

**Unit tests:**
- `encodeRobustFrame` / `decodeRobustFrame` with zero-length payload → ok:true, empty payload
- `decodeRobustFrame` on bytes missing mode byte → ok:false reason:no_sync
- `decodeRobustFrame` on normal frame bytes → ok:false (mode byte ≠ 0xFF)
- Preamble+sync header bytes verified for a sample payload

**Property tests (fast-check):**
- Property 7: header bytes check for all payloads 0–140 bytes
- Property 8: robust round-trip on clean channel, payloads 0–64 bytes, ≥100 runs
- Property 9: safety / no wrong accepts — BER 5%, 10%, 20%, ≥1000 trials each
- Property 10: SNR sweep comparison — 100 trials per BER level (5%, 10%, 15%, 20%), assert ≥20pp FEC gain at 10% BER

### Runtime Note

No new npm packages are required. `fast-check` is assumed already present (used in existing test files for slice 1/2). `vitest` is the test runner. All property tests use `fc.assert(fc.property(...))`.

---

## Runtime Dependencies

- No new npm packages added.
- `src/protocol/fec.ts` has no imports beyond TypeScript built-ins.
- `src/protocol/robust-frame.ts` imports from `./fec` and `./frame` (read-only: `crc16`, `DecodeResult`, `FailureReason`).
- `src/modem/demodulator.ts` gains no new imports.

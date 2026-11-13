/**
 * src/util/ring-buffer.ts
 * Fixed-capacity circular buffer of audio samples. Overwrites the oldest samples when full.
 * No Web Audio imports, so it runs under Vitest in Node.
 * Requirements (slice 2): 4.1–4.7
 */

export class RingBuffer {
  private readonly _data: Float32Array;
  private readonly _capacity: number;
  private _head = 0; // index of the oldest sample
  private _count = 0; // number of valid samples

  constructor(capacity: number) {
    if (!Number.isInteger(capacity) || capacity <= 0) {
      throw new RangeError("capacity must be a positive integer");
    }
    this._capacity = capacity;
    this._data = new Float32Array(capacity);
  }

  get capacity(): number {
    return this._capacity;
  }

  get length(): number {
    return this._count;
  }

  write(samples: Float32Array): void {
    const cap = this._capacity;
    // Only the last `cap` samples of a large write can survive.
    const src = samples.length > cap ? samples.subarray(samples.length - cap) : samples;
    for (let i = 0; i < src.length; i++) {
      const pos = (this._head + this._count) % cap;
      this._data[pos] = src[i]!;
      if (this._count < cap) {
        this._count++;
      } else {
        this._head = (this._head + 1) % cap; // overwrite oldest
      }
    }
  }

  /** Copy of all buffered samples, oldest first. Does not modify the buffer. */
  read(): Float32Array {
    const out = new Float32Array(this._count);
    const firstLen = Math.min(this._count, this._capacity - this._head);
    out.set(this._data.subarray(this._head, this._head + firstLen), 0);
    if (firstLen < this._count) {
      out.set(this._data.subarray(0, this._count - firstLen), firstLen);
    }
    return out;
  }

  clear(): void {
    this._head = 0;
    this._count = 0;
  }
}

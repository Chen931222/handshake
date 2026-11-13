// src/channel/audio-tx-processor.js
// Runs on the audio rendering thread (AudioWorkletGlobalScope). No imports allowed here.
// Plays one Float32Array, then tells the main thread it is done.
// Requirements (slice 2): 2.2, 2.3, 2.4, 2.6

class TxProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._buffer = null;
    this._offset = 0;
    this._done = false;
    this.port.onmessage = (e) => {
      this._buffer = e.data.samples;
      this._offset = 0;
      this._done = false;
    };
  }

  process(_inputs, outputs) {
    const out = outputs[0] && outputs[0][0];
    if (!out) return true;
    if (!this._buffer) {
      out.fill(0);
      return true; // still waiting for samples
    }
    const remaining = this._buffer.length - this._offset;
    const n = Math.min(out.length, remaining);
    out.set(this._buffer.subarray(this._offset, this._offset + n));
    if (n < out.length) out.fill(0, n);
    this._offset += n;
    // Copy the mono signal to any other output channels.
    for (let c = 1; c < outputs[0].length; c++) outputs[0][c].set(out);
    if (this._offset >= this._buffer.length && !this._done) {
      this._done = true;
      this.port.postMessage({ done: true });
      return false;
    }
    return true;
  }
}

registerProcessor("handshake-tx", TxProcessor);

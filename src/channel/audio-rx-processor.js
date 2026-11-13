// src/channel/audio-rx-processor.js
// Runs on the audio rendering thread (AudioWorkletGlobalScope). No imports allowed here.
// Forwards every captured mono block to the main thread.
// Requirements (slice 2): 3.3

class RxProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (channel && channel.length > 0) {
      const copy = channel.slice();
      this.port.postMessage({ chunk: copy }, [copy.buffer]);
    }
    return true;
  }
}

registerProcessor("handshake-rx", RxProcessor);

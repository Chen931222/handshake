# Tech

## Stack
- TypeScript, Vite, no UI framework. Plain DOM and CSS.
- Web Audio API: use AudioWorklet for both TX and RX. Never use ScriptProcessorNode.
- Testing: Vitest. Use fast-check for property-based tests.
- Static hosting, with a PWA service worker for offline use.

## Layers. Keep them separate; each one is testable without the one above it.
1. **modem**: turns bytes into audio samples and back (FSK first). Pure functions over Float32Array; no Web Audio here.
2. **protocol**: framing, preamble/sync, length, CRC, and later error correction. It turns a payload into bytes and back.
3. **channel**: adapters that run the modem against a real audio context (speaker and mic) or a simulated channel (noise, attenuation, frequency offset, dropouts) over BroadcastChannel.
4. **ui**: the séance interface. It reads signal metrics from the channel layer.

## Rules
- Every encode/decode pair must have a round-trip property test: for any payload, `decode(encode(p)) == p` over a clean channel. Under simulated noise up to the documented SNR, decoding either succeeds or reports failure. It must never return wrong data that passes the CRC.
- Keep modem parameters (frequencies, baud, symbol length) in one config object. Do not scatter them as magic numbers.
- Do not add a runtime dependency without a reason written in design.md.
- Mic access needs a user gesture and HTTPS (localhost is fine). Handle the case where permission is denied.
- Mobile browsers apply noise suppression and echo cancellation to the mic. Request `getUserMedia` with `echoCancellation`, `noiseSuppression`, and `autoGainControl` all set to `false`. Do not assume the browser honored this; detect it and report it.

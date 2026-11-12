# Structure

```
src/modem/      FSK modulator and demodulator (pure, no Web Audio)
src/protocol/   framing, CRC, error correction
src/channel/    real audio (AudioWorklet) and simulated channel
src/ui/         séance interface
test/           Vitest unit tests and fast-check property tests
measurements/   field test results: CSV, one row per device × environment × run
_contest/       hackathon research and write-up drafts (not shipped)
```

- Write file and folder names in kebab-case.
- One module per concern. Do not let a file grow past about 300 lines.
- Field measurement CSV columns: `date, tx_device, rx_device, environment, distance_m, payload_bytes, attempts, successes, notes`. Use only real measurements and never invent rows.

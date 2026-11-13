# Handshake

Send a short message from one phone to another with sound. No Wi-Fi, no cell signal, no pairing.

It is a 1960s acoustic modem rebuilt in the browser: binary FSK at 100 baud, two tones at 1800 and 2400 Hz, a preamble, a sync word, a length byte and a CRC-16. The interface is a séance. How clearly the spirit appears is the measured signal quality. A failed decode is a broken message from the other side, with the real reason underneath.

Built for Kiroween 2026, category **Resurrection**.

## Why

After the April 2024 Hualien earthquake, 172 mobile base stations went offline, most of them in Hualien and Yilan (National Communications Commission, via [CNA, 2024-04-03](https://www.cna.com.tw/news/ahel/202404030090.aspx)); most were back the same day. Where the towers are down, two people standing a metre apart cannot send each other a text. Handshake is for that gap: two devices, 0.5 to 3 m apart, nothing else.

It carries up to 140 bytes. That is about 140 English characters or 46 Chinese characters, enough for "I'm on the 3rd-floor stairwell, leg injured" and a position.

## Try it

**Live: https://handshake-azure-tau.vercel.app** (open it twice, or press *Open listener*).

```bash
npm install
npm run dev
```

- **Two tabs, simulated channel.** Open the page, press *Open listener*, type in the first tab, press Send. The samples travel over `BroadcastChannel`. The listening tab adds white noise and clock drift you choose, then decodes. Slide the noise down to −15 dB and watch it start to fail.
- **Two tabs or two devices, real sound.** Switch both to *Acoustic*. One plays through the speaker, the other listens through the microphone. Unplug headphones and turn the volume up.
- `/lab.html` runs a single-tab round trip. `/field.html` logs real device tests and exports CSV.

## What is measured

On the simulated channel (white noise over 0–24 kHz, random gain 0.8–1.2, clock drift ±200 ppm, random start offset), 50 messages of 1–140 bytes per level, from `test/noise.test.ts`:

| SNR (dB) | 30 | 20 | 10 | 5 | 0 | −5 | −10 | −15 | −20 |
|---|---|---|---|---|---|---|---|---|---|
| Decoded | 50/50 | 50/50 | 50/50 | 50/50 | 50/50 | 50/50 | 50/50 | 8/50 | 0/50 |

(Corrected 2026-11-13: an earlier version of this table said 16/50 at −15 dB. The test's noise generator was seeded with consecutive integers and gave correlated noise across trials; with an independent generator it is 8/50.)

### Error correction (robust mode)

Ticking *Error correction* sends a rate-1/2 convolutional code (constraint length 7, generators 171/133) with an interleaver, decoded by soft-decision Viterbi. It doubles the sound. Every listener tries both formats, so only the sender chooses. Both decoders accept a sync pattern with up to 2 wrong bits out of 24; the CRC still decides what is accepted.

Simulated channel, same message, 100 trials per cell (`test/fec.test.ts` and a one-off run):

| SNR (dB) | normal, 100 baud (1× sound) | normal, 50 baud (2× sound) | robust, 100 baud (2× sound) |
|---|---|---|---|
| −15 | 17/100 | 87/100 | 100/100 |
| −16.5 | 1/100 | 58/100 | 97/100 |
| −18 | 0/100 | 11/100 | 62/100 |

At equal sound, coding beats simply slowing down by about 3 dB. With an exact 24-bit sync match it did not: the uncoded header broke first. In the two-tab demo at −16 dB, 6 of 6 robust messages arrived and 0 of 6 normal ones.

Why it survives 0 dB: each bit is judged by the energy in a ~100 Hz Goertzel bin over 480 samples, about 24 dB of processing gain against noise spread over 24 kHz.

**Over the air, working (2026-11-13, same desktop: Realtek speakers → HyperX SoloCast USB mic, distance not measured, the speaker volume higher than in the first test; the tone arrived 34 dB above the room):**

| Mode | Decoded | Wrong messages accepted | Sound per message |
|---|---|---|---|
| Fast (no error correction), 100 baud | 0 / 5 | 0 | 2.7 s |
| Robust, 100 baud | 2 / 5 | 0 | 5.0 s |
| Robust, slow, 50 baud (direct test) | 5 / 5 | 0 | 8.5 s |
| Robust, slow, 50 baud, through the real Send and Listen screens | 5 / 5 | 0 | 12.7 s |

In the last row each message was on screen 0.5 to 1 s after its sound ended. "Robust, slow" is now the default mode; listeners try 100 and 50 baud on their own. One desktop and one room only; phones are not measured yet.

**First over-the-air test (2026-11-13, one desktop: Realtek speakers → HyperX SoloCast USB mic, same desk, distance not measured):** 0 of 10 messages decoded at 100 baud, 0 of 5 at 50 baud, 1 of 5 at 25 baud. The browser honored all three "off" requests (echo cancellation, noise suppression, auto gain). A steady 2400 Hz tone reached the mic at about −80 dBFS, 13 dB above the room. Aligning the received audio with what was sent shows 2–9% of bits wrong, scattered rather than bunched after tone changes, so the link is short of signal rather than smeared by echo; a 300-bit frame almost never arrives clean, and the checksum rejects it, as designed. Next: louder and closer, real phones, and error correction.

**Not measured yet: real phones.** The device × environment table lives in `measurements/field.csv`. It is empty until someone runs real tests. Rows are never estimated.

## What it will not do

- It is slow. 100 baud means a 140-byte message takes about 12 seconds of sound. 100 baud was chosen for margin against noise; faster rates have not been tested.
- CRC-16 does not make a wrong message impossible. A random corrupted frame passes it about once in 65,536. In 100 property-test runs that included −15 and −20 dB, none did; that is a sample, not a proof.
- Phones may keep echo cancellation, noise suppression or auto gain on even when asked not to. The listening screen reports what the browser actually honored.
- Prior work exists: [ggwave](https://github.com/ggerganov/ggwave) and other data-over-sound libraries. Handshake's differences are the disaster use case, a protocol sized for it, and a measured error-rate table.

## How it is built

Four layers, each testable without the one above it:

| Layer | Folder | What it does |
|---|---|---|
| modem | `src/modem` | bytes ↔ samples, Goertzel demodulator, bit-level sync search, tone clarity |
| protocol | `src/protocol` | framing and CRC-16/CCITT |
| channel | `src/channel` | AudioWorklet speaker and mic, simulated channel, BroadcastChannel |
| ui | `src/ui` | the séance screen, the lab page, the field log |

TypeScript, Vite, no UI framework, no runtime dependencies. 90+ Vitest tests, most of them fast-check properties: any payload round-trips on a clean channel; under any noise the decoder returns the exact payload or a failure, never different data.

## How Kiro was used

- **Steering** (`.kiro/steering/`): product, tech and structure rules that every spec obeys, including "never claim it works when the receiver could not decode".
- **Specs** (`.kiro/specs/`): two slices, each with requirements in EARS format, a design and a task list. Slice 1 is the modem and protocol; slice 2 is real audio and the two-tab demo. Both were reviewed by hand; the review caught a receiver that could not find a frame starting mid-symbol and a demo that framed messages twice. The fixes are in the spec files.
- **Who wrote the code.** Kiro executed slice 1's tasks (modem, protocol, simulated channel and their tests). Slice 2 was implemented from Kiro's slice-2 task list with another coding assistant after the free tier's 50 credits ran out. Both slices' specs were generated by Kiro and reviewed by hand.
- **Hooks** (`.kiro/hooks/*.json`, migrated to Kiro's current format by Kiro itself on 2026-11-13 and shown enabled in Kiro's hook editor; screenshot in `_contest/evidence/`): a change to the modem re-runs the property tests and refreshes the table above from the test output; a change to the field CSV checks it and never edits the rows.

## License

MIT

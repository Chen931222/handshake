# Devpost draft: Handshake (Kiroween 2026, Resurrection)

Fill-in fields are marked [TODO]. Every number below comes from a test or a measurement in this repo; keep it that way.

## Tagline (≤ 200 chars)

A 1960s acoustic modem, raised in the browser: send a short message phone to phone by sound when the network is gone.

## Inspiration

After the April 2024 Hualien earthquake, phone networks in Taiwan were jammed. People standing a metre apart could not pass a message. The oldest trick in networking, two machines whistling at each other over a phone line, needs no network at all. Handshake brings that dead technology back for that gap.

## What it does

- Turns up to 140 bytes of text (about 46 Chinese characters) into sound and back. Two tones, 1800 and 2400 Hz, 100 baud.
- Works in two modes: real sound (one device plays, the other listens through its microphone) and two browser tabs on one laptop, so a judge can see it without two phones.
- The interface is a séance board. The ring of the planchette lens is the measured tone clarity: sharp and bright when the tones are clean, smeared when noise wins. A failed decode slides to GOOD BYE and shows the real reason (no sync, bad length, checksum failed). It never shows a guess.
- Works offline after the first load. No account, no server.

## How we built it

- **Kiro steering** set three rules every spec obeys: layers that test without each other, a property test for every encode/decode pair, and "never claim it works when the receiver could not decode".
- **Two Kiro specs**, each with EARS requirements, a design and tasks: the modem and protocol first, then real audio and the two-tab demo.
- **Spec review caught real bugs before code existed.** Kiro's first design could not find a frame that started mid-symbol, so every real recording would have failed while the noise test passed vacuously. Its second design framed messages twice. Both fixes are in the spec files.
- **Kiro hooks** re-run the property tests when the modem changes and keep the README's measured table tied to the test output.
- **Who wrote what.** Kiro generated both specs (from steering written by hand and with a coding assistant) and wrote the slice-1 code (modem, framing, receiver, simulated channel and their tests). Slice 2's code (Web Audio, two-tab demo, séance screen) was written with another coding assistant, task by task from the tasks.md Kiro generated, after the free tier's 50 credits ran out. [TODO: update once the 4,000-credit grant is used for slice 3.]
- TypeScript, Vite, Web Audio AudioWorklet, BroadcastChannel, Vitest and fast-check. No runtime dependencies.

## Challenges

- Finding where a message starts in a stream of audio that never lines up with a symbol: the receiver tries 8 timing offsets and searches the sync pattern bit by bit.
- Making "spirit clarity" honest: it is the share of received energy that sits on the two modem tones, measured per symbol, not an animation.
- Offline: the service worker first listed a file Vite had deleted (so it never installed), then missed cached scripts because of a `Vary: Origin` header. Both were caught by stopping the server and reloading.

## Accomplishments

- 94 automated tests, most of them fast-check properties. The core one: under any noise, the decoder returns the exact message or a failure, never different data.
- Measured on the simulated channel: 50 of 50 messages decode down to −10 dB SNR, 16 of 50 at −15 dB, 0 of 50 at −20 dB.
- Verified in a real browser through the full Web Audio path (worklet out → worklet in) at both 48 kHz and 44.1 kHz.

## What we learned

[TODO: one or two sentences in the author's own words.]

## What's next

- Real phone tests across devices and rooms, logged in the field page. [TODO: replace with the measured table once it exists.]
- GPS and contact-card payloads, and error correction so one bad bit does not lose a whole message.

## Honest limits

- 100 baud: a full message takes about 12 seconds of sound.
- CRC-16 lets a random corrupted frame through about once in 65,536.
- Browsers may keep echo cancellation or noise suppression on; the listen screen reports what was honored.
- Prior work exists (ggwave and others).

## Submission fields

- Category: Resurrection
- Repo: [TODO: public GitHub URL]
- Demo: [TODO: deployed URL]
- Video (under 3 minutes, public YouTube; verified from the rules 2026-11-12): [TODO: URL]

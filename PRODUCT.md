# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **Primary (confirmed 2026-11-13): Kiroween hackathon judges.** One laptop, one or two browser tabs, a few minutes, possibly a noisy room. Their job is to see that data really travels by sound, judge how well it is built, and decide whether it is honest about its limits.
- **The story the product is built around (from steering):** two people standing 0.5–3 m apart whose network is down, for example after the April 2024 Hualien earthquake (172 mobile base stations offline, mostly in Hualien and Yilan; NCC via CNA). They need to pass a short message, a GPS position or an emergency contact card phone to phone. This audience shapes the content and constraints, not the first screen's layout.

## Product Purpose

Move short text between two devices using sound only: no Wi-Fi, no cell signal, no pairing. It is a 1960s acoustic modem rebuilt in the browser. Success for the judge surface: in one or two tabs the judge sends a message, watches it arrive or fail, and understands why.

## Positioning

Data-over-sound libraries already exist (ggwave and others) and the product says so. Its difference is: a protocol designed for the disaster use case, a measured device × environment × error-rate table, and a séance interface in which the theme carries the signal quality instead of decorating it.

## Operating Context

- Kiroween 2026, category Resurrection. Built with Kiro specs, steering and hooks (`.kiro/`).
- Two ways to demo: acoustic (one tab or phone plays, the other listens through the mic) and simulated (samples travel over BroadcastChannel between two tabs, with adjustable noise and clock drift).
- A field-measurement page records real attempts; only real rows.

## Capabilities and Constraints

- Payload up to 140 bytes of UTF-8 (one Chinese character is 3 bytes). 100 baud binary FSK at 1800/2400 Hz, so a full message takes about 12 s of audio. This slowness is real and must be shown, not hidden.
- Must work fully offline after first load (PWA). Nothing calls a server at runtime.
- Microphone needs a user gesture and a secure context; permission can be denied; browsers may ignore requests to turn off echo cancellation, noise suppression and auto gain, and the app reports what was honored.
- Measured on the simulated channel only (not real phones): 50/50 frames decode at −10 dB SNR and above, 16/50 at −15 dB, 0/50 at −20 dB.

## Brand Commitments

- Name: Handshake.
- Theme (steering, binding): a séance. Two phones "channel" each other; the sound you hear is the data. How clearly the spirit appears is the live signal quality. A failed decode is shown as a broken message from the other side, not a generic error.

## Evidence on Hand

- Simulated-channel success-rate table above (`test/noise.test.ts`).
- No real-device measurements yet. The device × environment table is empty and must not be filled with invented rows.
- No users, testimonials or press. Do not fabricate any.

## Product Principles

1. Honest over impressive: show the measured error rate and the failure, never a success the receiver did not decode.
2. The theme does a job: every spooky element maps to a real signal fact.
3. Slowness is part of the story: 100 baud is what makes it work through a phone speaker; say so.
4. Works with nothing: offline, no account, no server.

## Accessibility & Inclusion

Text must remain readable at all signal states. The "spirit clarity" effect may degrade the decorative layer but never the final decoded text or the failure reason.

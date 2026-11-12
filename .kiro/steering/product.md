# Product: Handshake

Handshake moves short text between two phones using sound, with no network at all. It works with no Wi-Fi, no cell signal, and no pairing. It is a 1960s acoustic modem rebuilt in the browser.

## Who it is for
- People whose network is down or overloaded but who are standing next to someone. Examples: after an earthquake when cell towers are jammed, or in a basement with no signal. The case we design around is the 2024 Hualien earthquake in Taiwan, when messaging was congested.
- It is not for long-distance messaging. It works phone to phone, about 0.5 to 3 m apart.

## What it sends
Short payloads only: a message of up to about 140 characters, a GPS position, or an emergency contact card. Anything larger is out of scope.

## Kiroween category
Resurrection: bringing a dead technology back with today's tools.

## Theme
The interface is a séance. Two phones "channel" each other, and the sound you hear is the data itself. The spookiness has to do a job:
- How clear the spirit looks is the live signal quality.
- A failed decode shows as a broken message from the other side, not a generic error.

## Non-negotiables
- It must work fully offline after the first load. It is a PWA, and nothing calls a server at runtime.
- A **two-tab demo mode** on one computer, so a judge with one laptop in a quiet or noisy room can see it work. It has two paths:
  - an acoustic path: one tab plays, the other tab listens through the mic;
  - a simulated-channel path: samples travel over BroadcastChannel with adjustable noise.
- Be honest about limits. Show the measured error rate. Never claim it works when the receiver could not decode.
- Differentiate from existing data-over-sound libraries (ggwave and others) through:
  - a measured device × environment × error-rate table;
  - the disaster use case;
  - a protocol designed for that use case.
  Do not hide that prior work exists.

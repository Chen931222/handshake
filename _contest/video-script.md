# Demo video script (under 3 minutes, public YouTube, English)

Rule check (verified 2026-11-12 from kiroween.devpost.com/rules): under 3 minutes, public on YouTube, English.
Screen recording at 1280×800 or larger. Voice-over in English; captions can be added afterwards.
Everything shown must be real. Do not stage a decode that did not happen.

| Time | Picture | Words (say roughly this) |
|---|---|---|
| 0:00–0:15 | Photo or headline of the April 2024 Hualien earthquake (only a source you are allowed to use), then the Handshake board. | "After the Hualien earthquake, phone networks in Taiwan jammed. People a metre apart couldn't pass a message. So I raised a dead technology: the acoustic modem." |
| 0:15–0:45 | Two browser tabs side by side. Left: Send. Right: Listen, Two tabs. Type the stairwell message, press Send. The lens spells it out; Yes lights. | "Text becomes two tones, 1800 and 2400 hertz, a hundred bits a second. The other tab decodes it. The ring of the planchette is not decoration: it's the measured share of energy on the two tones." |
| 0:45–1:15 | Drag the noise slider down to −15, then −20 dB. Send again. The ring breaks into dashes; GOOD BYE lights with the reason. | "Lower the signal and the ring breaks. When it can't decode, it says so, and why. It never shows a guess." |
| 1:15–1:40 | The On the air timeline and its key. | "Honest limit: it's slow. A full message is about twelve seconds of sound. That's the price of working through a phone speaker." |
| 1:40–2:10 | Real sound: laptop (or phone) plays, a second device listens. Show the constraint report (echo cancellation, noise suppression, auto gain). **Only include this if it actually decoded on camera.** | "And through the air: one device plays, the other listens. The listener reports which audio filters the browser really turned off." |
| 2:10–2:40 | Kiro: the steering files, the two specs (requirements, design, tasks), the hooks panel. | "Built with Kiro: steering sets the rules, two specs drove the build, and reviewing them caught a receiver that couldn't find a frame starting mid-symbol, before any code existed." |
| 2:40–2:55 | Test run: 94 passing, the SNR table. Then the offline reload. | "Ninety-four tests, most of them property tests: under any noise, it returns the exact message or a failure. And it works offline." |

Before recording:
- `npm run build` then `npx vite preview` (or the deployed URL), so the offline part is the real build.
- Turn the volume up, unplug headphones, quiet room for the acoustic part.
- Record the acoustic part last; if it fails, cut it and say "real-device tests are in the field log" instead.

# GenHacks submission draft (Handshake)

Rules checked 2026-11-13 from genhacks-open.devpost.com/rules (read through the owner's Chrome; Devpost blocks the fetch tool):
- Students 13+, any country except Devpost's standard exceptions; solo allowed.
- **Project must start after the hackathon begins (Nov 1, 2026).** Handshake's first commit is 2026-11-12 23:39 (+0800); the Kiroween research before it contains no code. 
- Submissions close **Dec 26, 2026, 12:00 AM Eastern**.
- Open-source libraries, APIs, templates and AI tools are allowed **if listed in the project description** (below).
- Entrant keeps all rights; GenHacks may show name, description, images and video for promotion.
- Not stated on the rules page: judging criteria, video length. [TODO: check the overview page again when joining.]
- The same project is also entered in Kiroween 2026. Neither rules page found forbids that. [TODO: confirm when joining; ask the organisers if unsure.]

Suggested track: **Open** (disaster communication is not health or environment in the narrow sense). Alternative: Healthcare & Environmental.

## Title
Handshake — text by sound when the towers are down

## Description (paste)

After the April 2024 Hualien earthquake, 172 mobile base stations went offline in Taiwan, mostly in Hualien and Yilan (NCC, via CNA). Where the towers are down, two people a metre apart cannot send each other a text.

Handshake sends up to 140 bytes from one device to another by sound: two tones at 1800 and 2400 Hz, 100 baud, a CRC-16, and an optional rate-1/2 convolutional code with soft-decision Viterbi decoding. It runs in the browser, works offline after the first load, and needs no account or server. The interface is a séance board: the ring of the planchette is the measured share of energy on the two tones, and a failed decode shows the real reason instead of a guess.

What is measured (simulated channel, 100 trials per cell): at the same length of sound, error correction decodes 97/100 at −16.5 dB where slowing down decodes 58/100. 107 automated tests, most of them property tests: under any noise the decoder returns the exact message or a failure, never different words.

What is not solved: the first real test through the air, desktop speaker to USB microphone, decoded 0 of 10 messages because the signal was too weak. Phone tests are next.

**Built with (as the rules require):**
- AI tools: Kiro (specs, steering, hooks); Claude Code (Anthropic) for code, review and tests; Windows speech synthesis for the video narration.
- Libraries: TypeScript, Vite, Vitest, fast-check, @fontsource/im-fell-english (font). No runtime dependencies.
- APIs: Web Audio (AudioWorklet), BroadcastChannel, Service Worker. Hosting: Vercel.

## Links
- Demo: https://handshake-azure-tau.vercel.app
- Repo: https://github.com/Chen931222/handshake (MIT)
- Video: [TODO: YouTube URL after the owner uploads `G:/Projects/_video-lab/films/handshake-demo/final.mp4`]

# 給 Kiro 的指令（照順序貼）

Kiro 怎麼開：File → Open Folder → `G:\Projects\handshake`。左邊 Kiro 面板會看到 Steering 有三份（product、tech、structure），那是 AI 先寫好的規範，Kiro 會自動讀。

Kiro 的免費額度這個月只有 50 credits（verified log 2026-11-12），所以第一個 spec 刻意做小：只做「不出聲」的那一半，先證明編碼和解碼是對的。出聲、收音等 4,000 credits 下來再做。

---

## Spec 1：modem＋protocol＋模擬通道

在 Kiro 聊天框上方選 **Spec**（不是 Vibe），貼下面整段：

```
Create a spec for the first slice of Handshake (read the steering docs first).

Scope of this slice — no real speaker/mic yet:
1. src/modem: binary FSK modulator and demodulator as pure functions over Float32Array (48 kHz sample rate, two tones in the 1.5–4 kHz range, configurable baud starting at 100). All parameters in one config object.
2. src/protocol: frame = preamble + sync word + length byte + payload (max 140 bytes, UTF-8) + CRC-16. encodeFrame / decodeFrame returning a result type: ok with payload, or a failure reason (no sync, bad length, CRC mismatch).
3. src/channel/simulated.ts: a simulated channel that adds white noise at a given SNR, random gain, a small frequency offset, and leading/trailing silence.
4. Tests (Vitest + fast-check):
   - property: for any UTF-8 string up to 140 bytes, clean channel round-trip returns the exact string
   - property: under simulated noise at any SNR, the decoder either returns the exact payload or a failure — never a different payload
   - a small report test that prints success rate vs SNR (e.g. 30, 20, 10, 5, 0 dB) for 50 random payloads each
5. A minimal dev page with two buttons that runs the simulated round-trip in the browser and shows the decoded text and success/failure. No séance styling yet.

Keep requirements in EARS format. Keep tasks small enough that each can be executed and tested on its own.
```

Kiro 會依序產生 requirements.md → design.md → tasks.md，每一份都要你按核准才往下走。**先別按 Run 執行任務**：三份都產生好、還沒執行時跟 Claude 說「spec 好了」，Claude 會先審一遍（有沒有寫錯、會不會太大吃光額度），再決定跑哪幾個 task。

---

## Spec 2：真的出聲收音＋兩分頁示範（2026-11-12 只產 spec，剩約 15 credits）

```
Create a new spec named handshake-audio-slice-2 (read the steering docs and the slice-1 spec first; reuse modulate, receive, simulateChannel and defaultConfig unchanged).
Scope:
1. src/channel/audio-tx.ts: play a Float32Array through an AudioWorklet (never ScriptProcessorNode). Resample-free: build the ModemConfig from audioContext.sampleRate (44100 or 48000), keeping 100 baud and the 1800/2400 Hz tones, which give a whole number of cycles per symbol at both rates.
2. src/channel/audio-rx.ts: getUserMedia with echoCancellation, noiseSuppression, autoGainControl all false; read track.getSettings() and report which of the three the browser actually honored. Capture through an AudioWorklet into a ring buffer sized for the longest frame plus one second; every 500 ms run receive() on the buffer; on ok, emit the payload once and clear the buffer. Handle permission denied and no-HTTPS with a visible message.
3. src/channel/broadcast.ts: the simulated path for the two-tab demo. Tab A sends the modulated samples over BroadcastChannel; tab B passes them through simulateChannel with a user-chosen SNR and drift, then receive().
4. Two-tab demo page: one page with a role switch (send / listen) and a path switch (acoustic / simulated). It shows the signal level, the decoded text or the failure reason, and how long the transmission took.
5. A field-measurement page that appends one CSV row per attempt in the columns from structure.md and offers the file as a download. Never invent rows.
Tests: the ring buffer, the 500 ms polling (with fake samples and fake timers), and the BroadcastChannel path (Node has BroadcastChannel) are unit-testable; Web Audio and getUserMedia are not, so isolate them behind small interfaces and list the manual checks in tasks.md.
Keep requirements in EARS format. Generate requirements, design and tasks in one pass with no refinement sub-agents; credits are very limited.
```

## 之後（等 4,000 credits）

- Spec 2 的 tasks：AudioWorklet 真的出聲與收音＋兩個分頁的示範模式。
- Spec 3：降靈會介面（訊號品質＝靈的清晰度）。
- Hooks：改 modem 參數就自動跑 PBT 與錯誤率報表（這是評分表 Technological Implementation 要看的東西，要由 Kiro 建）。
- 實測：借手機量「型號 × 環境 × 錯誤率」，只記真的量到的數字。

## Spec 3：錯誤更正＋慢速穩健模式（2026-11-13，剩約 6.3 credits，只產 spec）

```
Create a new spec named handshake-fec-slice-3. Read the steering docs and the two existing specs first; reuse modulate, demodulateBits, receive, encodeFrame/decodeFrame.
Why: the first real over-the-air test (desktop speaker to USB mic) failed: 0/10 frames at 100 baud. Aligning received audio with the transmitted waveform measured raw bit error rates of 16-19% at 100 baud, 5-7% at 50 baud and 0.6-7.7% at 25 baud, scattered (noise-limited, not echo). CRC rejected every damaged frame.
Scope:
1. src/protocol/fec.ts: rate-1/2 convolutional code, constraint length 7 (generators 171/133 octal), with a soft-decision Viterbi decoder that takes per-bit confidences (mark energy minus space energy, normalized). Tail-terminated.
2. A block interleaver over the coded bits so a burst becomes scattered single errors.
3. src/modem/demodulator.ts: add demodulateSoft() returning per-bit soft values; keep demodulateBits unchanged.
4. A "robust" mode: frame header (preamble + sync) stays uncoded so acquisition is unchanged; length + payload + CRC are FEC-coded and interleaved; baud selectable 100 / 50 / 25. Normal mode stays bit-for-bit compatible with slice 1.
5. Tests: round-trip properties for FEC alone and for the full robust pipeline; a property that the decoder never returns wrong data that passes CRC; an SNR sweep comparing normal vs robust at equal air time.
EARS requirements. Requirements, design and tasks in one pass, concise, no refinement sub-agents, no shell commands (the terminal cannot start on this machine; the spec folder will already exist).
```

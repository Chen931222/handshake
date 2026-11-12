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

## 之後（等 4,000 credits）

- Spec 2：AudioWorklet 真的出聲與收音＋兩個分頁的示範模式。
- Spec 3：降靈會介面（訊號品質＝靈的清晰度）。
- Hooks：改 modem 參數就自動跑 PBT 與錯誤率報表（這是評分表 Technological Implementation 要看的東西，要由 Kiro 建）。
- 實測：借手機量「型號 × 環境 × 錯誤率」，只記真的量到的數字。

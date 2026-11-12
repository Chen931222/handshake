/**
 * src/main.ts
 * Dev page entry point — wires the full simulated round-trip pipeline.
 * Requirements: 11.1–11.7
 *
 * Pipeline on button click:
 *   TextEncoder → encodeFrame → modulate → simulateChannel → receive
 *
 * No external libraries, no network requests, no séance styling.
 */

import { defaultConfig } from "./modem/config.js";
import { encodeFrame } from "./protocol/frame.js";
import { modulate } from "./modem/modulator.js";
import { simulateChannel } from "./channel/simulated.js";
import { receive } from "./modem/receiver.js";

const enc = new TextEncoder();

// ── DOM references (elements are defined in index.html) ──────────────────────
const messageInput  = document.getElementById("message-input")  as HTMLTextAreaElement;
const byteCounter   = document.getElementById("byte-counter")   as HTMLSpanElement;
const snrSelect     = document.getElementById("snr-select")     as HTMLSelectElement;
const sendButton    = document.getElementById("send-button")    as HTMLButtonElement;
const resultBox     = document.getElementById("result-box")     as HTMLDivElement;

// ── Byte counter ─────────────────────────────────────────────────────────────
function updateCounter(): void {
  const bytes = enc.encode(messageInput.value);
  const n = bytes.length;
  byteCounter.textContent = `${n} / 140 bytes`;
  byteCounter.classList.toggle("over-limit", n > 140);
  sendButton.disabled = n === 0 || n > 140;
}

messageInput.addEventListener("input", updateCounter);
updateCounter(); // initialise on load

// ── Send button ──────────────────────────────────────────────────────────────
sendButton.addEventListener("click", () => {
  const payload = enc.encode(messageInput.value);
  const snrDb = parseSnr(snrSelect.value);

  // Encode → modulate
  const frame = encodeFrame(payload);
  const samples = modulate(frame, defaultConfig);

  // Random leading silence 0–3×samplesPerSymbol (non-aligned, as in noise tests)
  const leadingSilenceSamples = Math.floor(
    Math.random() * 3 * defaultConfig.samplesPerSymbol,
  );

  // Simulate channel
  const impaired = simulateChannel(samples, {
    snrDb,
    leadingSilenceSamples,
    trailingSilenceSamples: defaultConfig.samplesPerSymbol,
    gainMin: 0.8,
    gainMax: 1.2,
  });

  // Receive
  const result = receive(impaired, defaultConfig);

  // Compute simulated audio duration
  const frameBits = frame.length * 8;
  const durationSec = frameBits / defaultConfig.baudRate;

  // Render result
  renderResult(result, snrDb, frame.length, durationSec);
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseSnr(value: string): number {
  if (value === "Infinity") return Infinity;
  return Number(value);
}

function renderResult(
  result: ReturnType<typeof receive>,
  snrDb: number,
  frameBytes: number,
  durationSec: number,
): void {
  const snrLabel = isFinite(snrDb) ? `${snrDb} dB` : "∞ (no noise)";
  const durationLabel = durationSec.toFixed(1);

  if (result.ok) {
    const decoded = new TextDecoder().decode(result.payload);
    resultBox.innerHTML = `
      <p class="status ok">✓ decode succeeded</p>
      <p class="decoded">${escapeHtml(decoded)}</p>
      <p class="meta">SNR: ${snrLabel} &nbsp;|&nbsp; Frame: ${frameBytes} bytes &nbsp;|&nbsp; Audio duration: ${durationLabel} s</p>
    `;
  } else {
    resultBox.innerHTML = `
      <p class="status fail">✗ decode failed</p>
      <p class="reason">Reason: ${result.reason}</p>
      <p class="meta">SNR: ${snrLabel} &nbsp;|&nbsp; Frame: ${frameBytes} bytes &nbsp;|&nbsp; Audio duration: ${durationLabel} s</p>
    `;
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * src/ui/app.ts
 * Main screen: Send / Listen × Acoustic (speaker + mic) / Simulated (BroadcastChannel between tabs).
 * All presentation goes through ./view.ts so the séance layer never touches the pipeline.
 * Requirements (slice 2): 1.1, 1.4, 3.0, 6.1–6.11
 */

import { encodeFrame, type DecodeResult } from "../protocol/frame.js";
import { encodeRobustFrame } from "../protocol/robust-frame.js";
import { codedLength } from "../protocol/fec.js";
import { modulate } from "../modem/modulator.js";
import { toneClarity } from "../modem/clarity.js";
import { defaultConfig, type ModemConfig } from "../modem/config.js";
import { play } from "../channel/audio-tx.js";
import { AudioRx } from "../channel/audio-rx.js";
import { broadcastListen, broadcastSend } from "../channel/broadcast.js";
import { simulateChannel } from "../channel/simulated.js";
import { configForSampleRate } from "../channel/rate-config.js";
import * as view from "./view.js";
import "@fontsource/im-fell-english/400.css";
import "./app.css";

type Role = "send" | "listen";
type Path = "acoustic" | "simulated";

const MAX_BYTES = 140;
const robustBox = document.getElementById("robust") as HTMLInputElement;
const enc = new TextEncoder();
const dec = new TextDecoder("utf-8", { fatal: false });

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const message = $<HTMLTextAreaElement>("message");
const sendBtn = $<HTMLButtonElement>("send");
const listenBtn = $<HTMLButtonElement>("listen-toggle");
const snr = $<HTMLInputElement>("snr");
const drift = $<HTMLInputElement>("drift");

const state: {
  role: Role;
  path: Path;
  ctx: AudioContext | null;
  config: ModemConfig;
  rx: AudioRx | null;
  stopSim: (() => void) | null;
  sending: boolean;
} = {
  role: "send",
  path: "simulated",
  ctx: null,
  config: defaultConfig,
  rx: null,
  stopSim: null,
  sending: false,
};

/** AudioContext must be created or resumed inside a user gesture. */
async function audio(): Promise<AudioContext> {
  if (!state.ctx) {
    state.ctx = new AudioContext();
    state.config = configForSampleRate(state.ctx.sampleRate);
  }
  if (state.ctx.state === "suspended") await state.ctx.resume();
  return state.ctx;
}

function bytes(): Uint8Array {
  return enc.encode(message.value);
}

/** The frame as it goes on the air, part by part, in bits. */
function frameParts(payloadBytes: number, robust: boolean): view.AirPart[] {
  if (!robust) {
    return [["Preamble", 32], ["Sync", 16], ["Length", 8], ["Message", 8 * payloadBytes], ["Check", 16]];
  }
  const head = 32 + 16 + codedLength(8);
  const body = codedLength(8 * (payloadBytes + 2));
  const pad = (8 - ((head + body) % 8)) % 8;
  return [["Preamble", 32], ["Sync", 16], ["Length, coded", codedLength(8)], ["Message + check, coded", body + pad]];
}

function airSeconds(payloadBytes: number, robust: boolean, config: ModemConfig = state.config): number {
  return frameParts(payloadBytes, robust).reduce((s, [, b]) => s + b, 0) / config.baudRate;
}

function refreshComposer(): void {
  const n = bytes().length;
  view.setByteCount(n, MAX_BYTES, n > 0 ? airSeconds(n, robustBox.checked) : 0);
  sendBtn.disabled = state.sending || n === 0 || n > MAX_BYTES;
}

function stopListening(): void {
  state.rx?.stop();
  state.rx = null;
  state.stopSim?.();
  state.stopSim = null;
  view.setListening(false);
}

function setMode(role: Role, path: Path): void {
  stopListening();
  state.role = role;
  state.path = path;
  view.setMode(role, path);
  if (role === "listen" && path === "simulated") startSimulatedListen();
  refreshComposer();
}

// ── Sending ────────────────────────────────────────────────────────────────
async function send(): Promise<void> {
  const payload = bytes();
  if (payload.length === 0 || payload.length > MAX_BYTES) return;
  state.sending = true;
  refreshComposer();
  try {
    const robust = robustBox.checked;
    const parts = frameParts(payload.length, robust);
    if (state.path === "acoustic") {
      const ctx = await audio();
      const samples = modulate(robust ? encodeRobustFrame(payload) : encodeFrame(payload), state.config);
      const seconds = samples.length / state.config.sampleRate;
      view.startTransmission(parts, state.config.baudRate, seconds);
      await play(samples, ctx);
      view.endTransmission(`Sent ${payload.length} bytes in ${seconds.toFixed(1)} s of sound.`);
    } else {
      const seconds = broadcastSend(payload, { config: state.config, robust });
      view.flashTransmission(
        parts,
        state.config.baudRate,
        seconds,
        `Posted to the other tab. As sound this would take ${seconds.toFixed(1)} s.`,
      );
    }
  } catch (err) {
    view.endTransmission(`Could not send: ${(err as Error).message}`);
  } finally {
    state.sending = false;
    refreshComposer();
  }
}

// ── Listening ──────────────────────────────────────────────────────────────
function show(result: DecodeResult, detail: string): void {
  if (result.ok) view.received(dec.decode(result.payload), result.payload.length, detail);
  else view.failed(result.reason, detail, result.corrupt ? dec.decode(result.corrupt) : undefined, result.corrupt?.length);
}

function startSimulatedListen(): void {
  view.setListening(true);
  const opts = () => ({
    snrDb: Number(snr.value),
    clockDriftPpm: Number(drift.value),
  });
  view.setChannel(opts().snrDb, opts().clockDriftPpm);
  // broadcastListen applies the impairments itself; we also measure clarity on our own copy.
  state.stopSim = broadcastListen(
    { config: state.config, channelOptions: opts() },
    ({ result, sentAt, audioSeconds, clarity, mode }) => {
      const latency = Math.max(0, Date.now() - sentAt);
      view.setClarity(clarity);
      show(
        result,
        `${mode === "robust" ? "error-corrected · " : ""}${opts().snrDb} dB · ${opts().clockDriftPpm} ppm · ${audioSeconds.toFixed(1)} s as sound · arrived ${latency} ms after Send`,
      );
    },
  );
  previewClarity();
}

/** Before anything arrives: clarity a frame would have at the current settings (a real impaired probe). */
function previewClarity(): void {
  const probe = modulate(encodeFrame(enc.encode("clarity probe")), state.config);
  const impaired = simulateChannel(probe, { snrDb: Number(snr.value), clockDriftPpm: Number(drift.value) });
  view.setClarity(toneClarity(impaired, state.config));
}

async function startAcousticListen(): Promise<void> {
  const ctx = await audio();
  const rx = new AudioRx({ config: state.config });
  state.rx = rx;
  rx.on("error", ({ reason }) => {
    view.listenError(reason);
    stopListening();
  });
  rx.on("constraint-report", (r) => view.constraints(r));
  rx.on("signal-level", ({ rms, clarity }) => view.setLevel(rms, clarity));
  rx.on("payload", ({ payload, frameSeconds, mode }) =>
    show({ ok: true, payload }, `${mode === "robust" ? "error-corrected · " : ""}${frameSeconds.toFixed(1)} s of sound · decoded from the microphone`),
  );
  view.setListening(true);
  await rx.start(ctx);
}

// ── Wiring ─────────────────────────────────────────────────────────────────
document.querySelectorAll<HTMLInputElement>('input[name="role"]').forEach((el) =>
  el.addEventListener("change", () => setMode(el.value as Role, state.path)),
);
document.querySelectorAll<HTMLInputElement>('input[name="path"]').forEach((el) =>
  el.addEventListener("change", () => setMode(state.role, el.value as Path)),
);
message.addEventListener("input", refreshComposer);
robustBox.addEventListener("change", refreshComposer);
sendBtn.addEventListener("click", () => void send());
listenBtn.addEventListener("click", () => {
  if (state.rx || state.stopSim) stopListening();
  else if (state.path === "acoustic") void startAcousticListen();
  else startSimulatedListen();
});
for (const el of [snr, drift]) {
  el.addEventListener("input", () => {
    view.setChannel(Number(snr.value), Number(drift.value));
    previewClarity();
  });
  el.addEventListener("change", () => {
    if (state.stopSim) {
      state.stopSim();
      startSimulatedListen();
    }
  });
}

// Second tab helper: open a listener next to this sender.
$<HTMLButtonElement>("open-listener").addEventListener("click", () => {
  window.open(`${location.pathname}?role=listen&path=simulated`, "_blank", "noopener");
});

const params = new URLSearchParams(location.search);
const initialRole = (params.get("role") as Role) === "listen" ? "listen" : "send";
const initialPath = (params.get("path") as Path) === "acoustic" ? "acoustic" : "simulated";
(document.querySelector(`input[name="role"][value="${initialRole}"]`) as HTMLInputElement).checked = true;
(document.querySelector(`input[name="path"][value="${initialPath}"]`) as HTMLInputElement).checked = true;
setMode(initialRole, initialPath);

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.register("./sw.js").catch(() => {});
}

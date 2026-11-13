/**
 * src/ui/view.ts
 * Presentation for the main screen. The séance does one job: the lens's veil and rim follow the
 * measured tone clarity, the reveal spells the decoded text, and failure moves to GOOD BYE with
 * the real reason. The decoded text and the reason themselves are never blurred.
 */

import type { ConstraintReport } from "../channel/audio-rx.js";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const els = {
  composer: $("composer"),
  listener: $("listener"),
  simControls: $("sim-controls"),
  micControls: $("mic-controls"),
  openListener: $<HTMLButtonElement>("open-listener"),
  listenBtn: $<HTMLButtonElement>("listen-toggle"),
  byteCount: $("byte-count"),
  pathHint: $("path-hint"),
  listenStatus: $("listen-status"),
  constraints: $("constraints"),
  snrOut: $<HTMLOutputElement>("snr-out"),
  planchette: $("planchette"),
  spirit: $("spirit"),
  reason: $("reason"),
  clarity: $("clarity"),
  rxBytes: $("rx-bytes"),
  rxDetail: $("rx-detail"),
  yes: $("word-yes"),
  no: $("word-no"),
  goodbye: $("goodbye"),
  timeline: $("timeline"),
  airSeconds: $("air-seconds"),
  airNote: $("air-note"),
  airtime: $("airtime"),
};

const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)");
let revealTimer: ReturnType<typeof setInterval> | null = null;
let airFrame = 0;

const fmtSeconds = (s: number) => `${s.toFixed(1)} s`;

// ── Modes ──────────────────────────────────────────────────────────────────
export function setMode(role: "send" | "listen", path: "acoustic" | "simulated"): void {
  els.composer.hidden = role !== "send";
  els.listener.hidden = role !== "listen";
  els.airtime.hidden = role !== "send";
  els.openListener.hidden = path !== "simulated";
  els.simControls.hidden = path !== "simulated";
  els.micControls.hidden = path !== "acoustic";
  els.constraints.hidden = true;
  els.pathHint.textContent =
    path === "simulated"
      ? "Two tabs: the samples travel to the listening tab, which adds the noise you set there."
      : "Sound: this device plays the message. Put the listening device 0.5 to 3 m away.";
  els.listenStatus.textContent =
    path === "simulated"
      ? "Listening for the other tab. Lower the signal to see where it breaks."
      : "Press Start listening and allow the microphone.";
}

export function setListening(on: boolean): void {
  els.listenBtn.textContent = on ? "Stop listening" : "Start listening";
  els.listenBtn.setAttribute("aria-pressed", String(on));
  els.planchette.dataset.listening = String(on);
}

// ── Composer ───────────────────────────────────────────────────────────────
export function setByteCount(n: number, max: number, seconds: number): void {
  const over = n > max;
  els.byteCount.textContent =
    n === 0 ? `0 / ${max} bytes` : `${n} / ${max} bytes · ${fmtSeconds(seconds)} of sound`;
  els.byteCount.classList.toggle("over", over);
  if (over) els.byteCount.textContent += ` · ${n - max} too many`;
}

// ── Air time ───────────────────────────────────────────────────────────────
function drawTimeline(frameBytes: number): void {
  const payload = frameBytes - 9;
  const parts: Array<[string, number]> = [
    ["Preamble", 4],
    ["Sync", 2],
    ["Length", 1],
    ["Message", payload],
    ["Check", 2],
  ];
  els.timeline.replaceChildren(
    ...parts.map(([label, bytes]) => {
      const seg = document.createElement("div");
      seg.className = `seg seg-${label.toLowerCase()}`;
      seg.style.flex = `${bytes} 1 0`; // basis 0: width is the duration only, never the label
      seg.title = `${label}: ${bytes} byte${bytes === 1 ? "" : "s"}, ${((bytes * 8) / 100).toFixed(2)} s`;
      const name = document.createElement("span");
      name.textContent = label;
      const dur = document.createElement("span");
      dur.className = "dur";
      dur.textContent = `${((bytes * 8) / 100).toFixed(2)} s`;
      seg.append(name, dur);
      return seg;
    }),
  );
  const fill = document.createElement("div");
  fill.className = "fill";
  els.timeline.append(fill);
  els.timeline.setAttribute(
    "aria-label",
    `Frame of ${frameBytes} bytes: ${payload} message bytes and 9 bytes of framing.`,
  );
}

function setFill(fraction: number): void {
  const fill = els.timeline.querySelector<HTMLElement>(".fill");
  if (fill) fill.style.transform = `scaleX(${Math.min(1, Math.max(0, fraction))})`;
}

export function startTransmission(frameBytes: number, seconds: number): void {
  drawTimeline(frameBytes);
  els.airSeconds.textContent = fmtSeconds(seconds);
  els.airNote.textContent = "Playing through the speaker now.";
  els.timeline.dataset.live = "true";
  const t0 = performance.now();
  cancelAnimationFrame(airFrame);
  const tick = () => {
    const f = (performance.now() - t0) / 1000 / seconds;
    setFill(f);
    if (f < 1) airFrame = requestAnimationFrame(tick);
  };
  airFrame = requestAnimationFrame(tick);
}

export function endTransmission(note: string): void {
  cancelAnimationFrame(airFrame);
  setFill(1);
  els.timeline.dataset.live = "false";
  els.airNote.textContent = note;
}

export function flashTransmission(frameBytes: number, seconds: number, note: string): void {
  drawTimeline(frameBytes);
  els.airSeconds.textContent = fmtSeconds(seconds);
  setFill(1);
  els.timeline.dataset.live = "false";
  els.airNote.textContent = note;
}

// ── Board ──────────────────────────────────────────────────────────────────
export function setClarity(c: number): void {
  const v = Math.max(0, Math.min(1, c));
  els.planchette.style.setProperty("--clarity", v.toFixed(3));
  els.clarity.textContent = `${Math.round(v * 100)}%`;
}

export function setLevel(rms: number, clarity: number): void {
  // Below this the mic hears essentially nothing; clarity of silence is meaningless.
  setClarity(rms < 0.002 ? 0 : clarity);
}

export function setChannel(snrDb: number, driftPpm: number): void {
  els.snrOut.textContent = `${snrDb} dB`;
  els.listenStatus.textContent = `Listening for the other tab at ${snrDb} dB and ${driftPpm} ppm drift.`;
}

function spell(text: string): void {
  if (revealTimer) clearInterval(revealTimer);
  const letters = Array.from(text);
  if (reduceMotion.matches || letters.length === 0) {
    els.spirit.textContent = text;
    return;
  }
  els.spirit.textContent = "";
  const visible = document.createElement("span");
  const ghost = document.createElement("span");
  ghost.className = "ghost";
  ghost.textContent = text; // reserves the final layout so nothing jumps
  ghost.setAttribute("aria-hidden", "true");
  els.spirit.append(visible, ghost);
  let i = 0;
  const step = Math.max(12, Math.min(45, 1400 / letters.length));
  revealTimer = setInterval(() => {
    i++;
    visible.textContent = letters.slice(0, i).join("");
    ghost.textContent = letters.slice(i).join("");
    if (i >= letters.length && revealTimer) {
      clearInterval(revealTimer);
      revealTimer = null;
      els.spirit.textContent = text;
    }
  }, step);
}

export function received(text: string, bytes: number, detail: string): void {
  els.planchette.dataset.state = "yes";
  els.yes.classList.add("lit");
  els.no.classList.remove("lit");
  els.goodbye.classList.remove("lit");
  els.reason.textContent = "";
  spell(text);
  els.rxBytes.textContent = String(bytes);
  els.rxDetail.textContent = detail;
}

const REASONS: Record<string, string> = {
  no_sync: "No sync. The board never heard the spirit begin. Nothing is shown rather than a guess.",
  bad_length: "Bad length. The spirit's count of words was garbled, so the message was discarded.",
  crc_mismatch: "Checksum failed. The words arrived broken; Handshake will not show broken words as real ones.",
};

export function failed(reason: string, detail: string): void {
  if (revealTimer) clearInterval(revealTimer);
  els.planchette.dataset.state = "no";
  els.yes.classList.remove("lit");
  els.no.classList.add("lit");
  els.goodbye.classList.add("lit");
  els.spirit.textContent = "The message did not come through.";
  els.reason.textContent = REASONS[reason] ?? reason;
  els.rxBytes.textContent = "0";
  els.rxDetail.textContent = detail;
}

export function listenError(reason: string): void {
  const text: Record<string, string> = {
    "requires-https": "The microphone needs a secure page (https or localhost). Open this page over https and try again.",
    "permission-denied": "Microphone permission was denied. Allow it in the browser's site settings, then press Start listening.",
  };
  els.listenStatus.textContent = text[reason] ?? `The microphone could not start: ${reason}`;
}

export function constraints(r: ConstraintReport): void {
  const names: Record<string, string> = {
    echoCancellation: "Echo cancellation",
    noiseSuppression: "Noise suppression",
    autoGainControl: "Auto gain",
  };
  els.constraints.replaceChildren(
    ...Object.entries(r).flatMap(([k, v]) => {
      const dt = document.createElement("dt");
      dt.textContent = names[k] ?? k;
      const dd = document.createElement("dd");
      dd.textContent = v.honored ? "off, as asked" : v.actual === undefined ? "unknown" : "still on";
      dd.className = v.honored ? "ok" : "warn";
      return [dt, dd];
    }),
  );
  els.constraints.hidden = false;
  const ignored = Object.values(r).filter((v) => !v.honored).length;
  els.listenStatus.textContent =
    ignored === 0
      ? "Listening. The browser gave raw audio."
      : `Listening. The browser kept ${ignored} of 3 audio filters on, which can hurt decoding.`;
}

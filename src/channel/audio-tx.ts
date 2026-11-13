/**
 * src/channel/audio-tx.ts
 * Plays modulated samples through an AudioWorklet (never ScriptProcessorNode).
 * Requirements (slice 2): 2.1–2.6
 */

const DEFAULT_TX_WORKLET = new URL("./audio-tx-processor.js", import.meta.url).href;

export interface AudioTxOptions {
  workletUrl?: string;
}

const loaded = new WeakMap<BaseAudioContext, Set<string>>();

export async function loadWorklet(ctx: BaseAudioContext, url: string): Promise<void> {
  let set = loaded.get(ctx);
  if (!set) {
    set = new Set();
    loaded.set(ctx, set);
  }
  if (set.has(url)) return;
  await ctx.audioWorklet.addModule(url);
  set.add(url);
}

/** Resolves when every sample has been handed to the audio output. */
export async function play(
  samples: Float32Array,
  ctx: AudioContext,
  options: AudioTxOptions = {},
): Promise<void> {
  if (samples.length === 0) return;
  if (ctx.state === "suspended") await ctx.resume();
  await loadWorklet(ctx, options.workletUrl ?? DEFAULT_TX_WORKLET);
  const node = new AudioWorkletNode(ctx, "handshake-tx", {
    numberOfInputs: 0,
    numberOfOutputs: 1,
    outputChannelCount: [1],
  });
  node.connect(ctx.destination);
  await new Promise<void>((resolve) => {
    node.port.onmessage = (e: MessageEvent<{ done?: boolean }>) => {
      if (e.data.done) resolve();
    };
    const copy = samples.slice(); // transfer a copy; the caller keeps its array
    node.port.postMessage({ samples: copy }, [copy.buffer]);
  });
  node.port.onmessage = null;
  node.disconnect();
}

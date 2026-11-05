"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { MAX_TRANSCRIPTION_SECONDS, TRANSCRIPTION_SAMPLE_RATE } from "@bytewise/shared";
import { api, liveTranscriptionUrl } from "@/lib/api-client";

export type DictationStatus = "idle" | "starting" | "recording" | "finishing";

/** Number of bars in the waveform. */
export const WAVE_BARS = 14;
const TICK_MS = 100;
const FINAL_TIMEOUT_MS = 15_000;
const MIN_FALLBACK_BYTES = TRANSCRIPTION_SAMPLE_RATE / 2; // 250 ms of PCM16

// Copies microphone samples to the main thread. Loaded from a Blob URL so no
// separate static file is needed.
const WORKLET_SOURCE = `
class PcmCapture extends AudioWorkletProcessor {
  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (channel) this.port.postMessage(channel.slice(0));
    return true;
  }
}
registerProcessor("pcm-capture", PcmCapture);
`;

/** Streaming linear resampler to 24 kHz PCM16; carries its position across chunks. */
export function createResampler(inputRate: number) {
  const ratio = inputRate / TRANSCRIPTION_SAMPLE_RATE;
  let carry = new Float32Array(0);
  let pos = 0;
  return (input: Float32Array): Uint8Array => {
    const data = new Float32Array(carry.length + input.length);
    data.set(carry);
    data.set(input, carry.length);
    const out: number[] = [];
    while (pos + 1 < data.length) {
      const base = Math.floor(pos);
      const sample = data[base]! + (data[base + 1]! - data[base]!) * (pos - base);
      const clamped = Math.max(-1, Math.min(1, sample));
      out.push(clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff);
      pos += ratio;
    }
    const keep = Math.floor(pos);
    carry = data.slice(keep);
    pos -= keep;
    const view = new DataView(new ArrayBuffer(out.length * 2));
    out.forEach((s, i) => view.setInt16(i * 2, s, true));
    return new Uint8Array(view.buffer);
  };
}

/** Loudness on a 0–1 scale (RMS, scaled so speech fills it). */
export function audioLevel(samples: Float32Array[]): number {
  let sum = 0;
  let n = 0;
  for (const chunk of samples) {
    for (const v of chunk) sum += v * v;
    n += chunk.length;
  }
  return n ? Math.min(1, Math.sqrt(Math.sqrt(sum / n) * 6)) : 0;
}

/**
 * Live dictation: words arrive through `onText` while the developer speaks
 * (`final` once at the end). Nothing is ever sent to the agent from here.
 */
export function useLiveDictation(onText: (text: string, final: boolean) => void) {
  const [status, setStatus] = useState<DictationStatus>("idle");
  const [levels, setLevels] = useState<number[]>(() => Array(WAVE_BARS).fill(0));
  const [error, setError] = useState<string | null>(null);
  /** Bumped by cancel(), so a start still waiting for the mic gives up. */
  const generation = useRef(0);
  const onTextRef = useRef(onText);
  onTextRef.current = onText;

  const run = useRef<{
    stream: MediaStream;
    context: AudioContext;
    node: AudioWorkletNode;
    workletUrl: string;
    timer: ReturnType<typeof setInterval>;
    ws: WebSocket;
    /** Everything recorded, for a one-off transcription if the live link fails. */
    pcm: Uint8Array[];
    liveFailed: boolean;
    final: Promise<string | null>;
    cancelled: boolean;
  } | null>(null);

  const releaseMic = useCallback((r: NonNullable<typeof run.current>) => {
    clearInterval(r.timer);
    r.node.port.onmessage = null;
    r.node.disconnect();
    r.stream.getTracks().forEach((t) => t.stop());
    void r.context.close();
    URL.revokeObjectURL(r.workletUrl);
  }, []);

  const cancel = useCallback(() => {
    generation.current++;
    const r = run.current;
    if (!r) {
      setStatus((s) => (s === "starting" ? "idle" : s));
      return;
    }
    run.current = null;
    r.cancelled = true;
    releaseMic(r);
    r.ws.close();
    setStatus("idle");
    setLevels(Array(WAVE_BARS).fill(0));
  }, [releaseMic]);

  const stop = useCallback(async () => {
    const r = run.current;
    if (!r || r.cancelled) return;
    run.current = null;
    releaseMic(r);
    setStatus("finishing");
    setLevels(Array(WAVE_BARS).fill(0));
    if (r.ws.readyState === WebSocket.OPEN) r.ws.send('{"type":"stop"}');
    let timer: ReturnType<typeof setTimeout> | undefined;
    let text = await Promise.race([
      r.final,
      new Promise<null>((resolve) => (timer = setTimeout(() => resolve(null), FINAL_TIMEOUT_MS))),
    ]);
    clearTimeout(timer);
    if (text === null) {
      // The live link failed: transcribe the whole recording once instead.
      const bytes = r.pcm.reduce((n, c) => n + c.length, 0);
      if (bytes >= MIN_FALLBACK_BYTES) {
        const all = new Uint8Array(bytes);
        let offset = 0;
        for (const c of r.pcm) {
          all.set(c, offset);
          offset += c.length;
        }
        try {
          text = (await api.transcribe(all.buffer)).text;
          setError(null);
        } catch (e) {
          setError(e instanceof Error ? e.message : "Transcription failed.");
        }
      }
    }
    if (r.cancelled) return;
    onTextRef.current((text ?? "").trim(), true);
    if (text !== null && !text.trim()) {
      setError("No speech was recognized. Try again closer to the microphone.");
    }
    setStatus("idle");
  }, [releaseMic]);

  const start = useCallback(async () => {
    if (run.current) return;
    const gen = ++generation.current;
    setError(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("This browser cannot record audio here.");
      return;
    }
    setStatus("starting");
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
      });
    } catch {
      setStatus("idle");
      setError("Microphone access was denied.");
      return;
    }
    const context = new AudioContext();
    const workletUrl = URL.createObjectURL(
      new Blob([WORKLET_SOURCE], { type: "application/javascript" }),
    );
    await context.audioWorklet.addModule(workletUrl);
    if (gen !== generation.current) {
      // Cancelled (e.g. the message was sent) while the microphone was starting.
      stream.getTracks().forEach((t) => t.stop());
      void context.close();
      URL.revokeObjectURL(workletUrl);
      return;
    }
    const node = new AudioWorkletNode(context, "pcm-capture");
    const resample = createResampler(context.sampleRate);

    const ws = new WebSocket(liveTranscriptionUrl());
    ws.binaryType = "arraybuffer";
    const outbox: Uint8Array[] = [];
    let resolveFinal!: (text: string | null) => void;
    const final = new Promise<string | null>((r) => (resolveFinal = r));

    const markFailed = (message: string) => {
      const r = run.current;
      if (r && !r.liveFailed) {
        r.liveFailed = true;
        setError(`${message} It will be transcribed when you stop.`);
      }
      resolveFinal(null);
    };
    ws.onopen = () => {
      for (const chunk of outbox.splice(0)) ws.send(chunk);
    };
    ws.onmessage = (event) => {
      let msg: { type?: string; text?: unknown; message?: unknown };
      try {
        msg = JSON.parse(String(event.data));
      } catch {
        return;
      }
      if (msg.type === "text" && typeof msg.text === "string") onTextRef.current(msg.text, false);
      else if (msg.type === "final" && typeof msg.text === "string") resolveFinal(msg.text);
      else if (msg.type === "error") {
        markFailed(typeof msg.message === "string" ? msg.message : "Live transcription failed.");
      }
    };
    ws.onerror = () => markFailed("Live transcription is unavailable.");
    ws.onclose = () => resolveFinal(null); // no-op once a final text arrived

    let pendingSamples: Float32Array[] = [];
    node.port.onmessage = (e: MessageEvent<Float32Array>) => pendingSamples.push(e.data);
    context.createMediaStreamSource(stream).connect(node);

    const started = Date.now();
    const timer = setInterval(() => {
      const r = run.current;
      if (!r) return;
      const samples = pendingSamples;
      pendingSamples = [];
      const level = audioLevel(samples);
      setLevels((prev) => [...prev.slice(1), level]);
      const chunk = resample(
        samples.reduce((all, c) => {
          const next = new Float32Array(all.length + c.length);
          next.set(all);
          next.set(c, all.length);
          return next;
        }, new Float32Array(0)),
      );
      if (chunk.length) {
        r.pcm.push(chunk);
        if (!r.liveFailed) {
          if (ws.readyState === WebSocket.OPEN) ws.send(chunk);
          else if (ws.readyState === WebSocket.CONNECTING) outbox.push(chunk);
        }
      }
      if (Date.now() - started >= MAX_TRANSCRIPTION_SECONDS * 1000) void stop();
    }, TICK_MS);

    run.current = {
      stream,
      context,
      node,
      workletUrl,
      timer,
      ws,
      pcm: [],
      liveFailed: false,
      final,
      cancelled: false,
    };
    setStatus("recording");
  }, [stop]);

  // Never leave the microphone on after unmounting.
  useEffect(() => () => cancel(), [cancel]);

  return { status, levels, error, start, stop, cancel, clearError: () => setError(null) };
}
